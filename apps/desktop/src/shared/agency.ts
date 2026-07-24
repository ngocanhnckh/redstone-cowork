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

/** Public GitHub activity for an agent (recent-events window). */
export type AgencyGithubStat = {
  username: string; found: boolean; publicRepos: number; followers: number;
  commits: number; prs: number; issues: number; reviews: number; activeRepos: number;
};

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

export type AgencyMissionComment = { author: string | null; created: string; bodyHtml: string };
export type AgencyMissionTransition = { id: string; name: string; to: string };
export type AgencyMissionDetail = {
  key: string; summary: string; status: string; statusCategory: string; assignee: string | null; url: string;
  descriptionHtml: string; description: string; issueType: string;
  comments: AgencyMissionComment[];
};
