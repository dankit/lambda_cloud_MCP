import { describe, expect, it } from "vitest";
import {
  buildBackgroundJobScript,
  buildJobSignalScript,
  buildJobStatusScript,
  newJobId,
  parseBackgroundStartOutput,
  parseJobStatusOutput,
} from "./jobs";

describe("newJobId", () => {
  it("produces a filesystem-safe id", () => {
    const id = newJobId();
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
  it("produces distinct ids", () => {
    expect(newJobId()).not.toBe(newJobId());
  });
});

describe("buildBackgroundJobScript", () => {
  it("detaches with setsid and records pid/rc/log", () => {
    const script = buildBackgroundJobScript({
      jobId: "job-abc",
      command: "python train.py",
    });
    expect(script).toContain("setsid bash -lc");
    expect(script).toContain('python train.py; echo $? > "$HOME/.lambda-mcp/jobs/job-abc.rc"');
    expect(script).toContain('"$d/job-abc.log"');
    expect(script).toContain('echo $! > "$d/job-abc.pid"');
  });
  it("prints the job id and pid on the final line", () => {
    const script = buildBackgroundJobScript({ jobId: "job-abc", command: "ls" });
    expect(script).toContain("printf '%s %s\\n' 'job-abc' \"$!\"");
  });
  it("rejects unsafe job ids", () => {
    expect(() =>
      buildBackgroundJobScript({ jobId: "bad id;rm -rf", command: "ls" })
    ).toThrow("Invalid job id");
  });
});

describe("buildJobStatusScript", () => {
  it("checks liveness and tails the log with a bounded count", () => {
    const script = buildJobStatusScript("job-abc", 50);
    expect(script).toContain('kill -0 "$pid"');
    expect(script).toContain("tail -n 50");
    expect(script).toContain("---LOG---");
  });
  it("clamps the line count to the max", () => {
    const script = buildJobStatusScript("job-abc", 999999);
    expect(script).toContain("tail -n 5000");
  });
});

describe("buildJobSignalScript", () => {
  it("signals the process group with a fallback to the pid", () => {
    const script = buildJobSignalScript("job-abc", "INT");
    expect(script).toContain('kill -INT -"$pid"');
    expect(script).toContain('kill -INT "$pid"');
  });
  it("defaults to TERM", () => {
    expect(buildJobSignalScript("job-abc")).toContain("kill -TERM");
  });
});

describe("parseBackgroundStartOutput", () => {
  it("extracts jobId and pid from the printed line", () => {
    expect(parseBackgroundStartOutput("job-abc 12345\n")).toEqual({
      jobId: "job-abc",
      pid: "12345",
    });
  });
  it("tolerates a missing pid", () => {
    expect(parseBackgroundStartOutput("job-abc\n")).toEqual({
      jobId: "job-abc",
      pid: null,
    });
  });
});

describe("parseJobStatusOutput", () => {
  it("parses a running job with no exit code yet", () => {
    const out = [
      "found=1",
      "pid=12345",
      "running=1",
      "exitcode=",
      "logpath=/home/ubuntu/.lambda-mcp/jobs/job-abc.log",
      "---LOG---",
      "epoch 1",
      "epoch 2",
    ].join("\n");
    const parsed = parseJobStatusOutput(out);
    expect(parsed).toMatchObject({
      found: true,
      running: true,
      pid: "12345",
      exitCode: null,
      logPath: "/home/ubuntu/.lambda-mcp/jobs/job-abc.log",
    });
    expect(parsed.logTail).toBe("epoch 1\nepoch 2");
  });
  it("parses a finished job exit code", () => {
    const out = ["found=1", "pid=1", "running=0", "exitcode=0", "logpath=/x", "---LOG---", "done"].join(
      "\n"
    );
    const parsed = parseJobStatusOutput(out);
    expect(parsed.running).toBe(false);
    expect(parsed.exitCode).toBe(0);
  });
  it("parses a missing job", () => {
    const out = "found=0\nrunning=0\npid=\nexitcode=\nlogpath=\n---LOG---\n";
    const parsed = parseJobStatusOutput(out);
    expect(parsed.found).toBe(false);
    expect(parsed.pid).toBeNull();
    expect(parsed.logTail).toBe("");
  });
});
