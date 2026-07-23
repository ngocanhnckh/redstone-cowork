/** Server registry row as seen by the desktop (mirrors @rcw/shared Server). */
export interface ServerView {
  id: string;
  name: string;
  host: string;
  sshUser: string;
  sshPort: number;
  description: string;
  ownerAccountId: string | null;
  keyInstalled: boolean;
  createdBy: string | null;
  createdAt: string;
  access?: string[]; // ACL usernames (admin view of company servers)
}
