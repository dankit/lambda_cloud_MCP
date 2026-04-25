import { SSH_PORT, SSH_USER } from "./constants";

export function buildSshCommandLine(ip: string, pemPath: string): string {
  return `ssh -i "${pemPath}" -p ${SSH_PORT} ${SSH_USER}@${ip}`;
}
