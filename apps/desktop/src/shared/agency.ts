// Shared shapes for Agency messaging (org chat + DMs), mirrored from the API's
// AgencyMessageView / AgencyThreadView.

export type AgencyAttachment = { name: string; url: string; size: number; mime: string };

export type AgencyPerson = { accountId: string; username: string; displayName: string; photo: string | null };

export type AgencyMessage = {
  id: string;
  channel: string;
  body: string;
  attachments: AgencyAttachment[];
  createdAt: string;
  from: AgencyPerson;
  toAccountId: string | null;
};

export type AgencyThread = { channel: string; other: AgencyPerson; lastAt: string };

/** Per-agent Jira workload counts for the Arena leaderboard. */
export type AgencyJiraStat = { accountId: string; completed: number; inProgress: number; todo: number; total: number };

/** One assigned Jira issue (mission) in an agent's list. */
export type AgencyMission = {
  key: string;
  summary: string;
  status: string;
  statusCategory: "todo" | "inprogress" | "done";
  assignee: string | null;
  url: string;
  project?: { key: string; name: string };
};
