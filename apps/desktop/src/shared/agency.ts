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
