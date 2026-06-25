> ⚠️ **Superseded 2026-06-26.** This document describes the original "simulated company / virtual team" vision. Cowork has pivoted to **a cognitive-load-efficient control plane for coding agents**; the connector / virtual-team / situation-room scope moved to the separate **redstone-agent** project. See [`PLAN.md`](./PLAN.md) and [`superpowers/specs/2026-06-26-remote-agent-control-plane-design.md`](./superpowers/specs/2026-06-26-remote-agent-control-plane-design.md). Kept for historical context.

# Abstract

Redstone Cowork is an assistant that can help anyone to manage their productivity and agents. A normal worker face many different data stream (from jira, emails, messages from mattermost slack whatsapp...) and struggle to manage their own contexts and tasks.
Redstone Cowork aim to create clarity and optimize productivity.

The concept of Redstone Cowork is any users of it is a CEO of a company under them self. While there real company in real life could be their mother company. Redstone Cowork will simulate a company run with a purpose that help the CEO ace his work and life perfectly.

Also it address another problem for dev, when managing many agents (Claude Code Agent), they could ask for confirmation or already completed the task but the dev didnt know. Leaving dead time when dev mulitask.

# Platform

- Web: NextJS built
- Android & iOS: React Native
- Apple watch
- MacOS and Windows: Electron

# Features description
- User can connect their JIRA using their PAT (support jira selfhost datacenter)
- User can connect to their Gmail, Outlook
- User can connect their calendar
- User can connect their Mattermost (via PAT)
- Other platform (will do after all above platform is integrated): Slack, Zalo, 
- The agent (event based) poll on user's new messages / tasks / calendar event / email /claude code sessions and map all the tasks and missions they have, sort them by importance and urgency, group them by project and entity. Whenever user updated a task status on their personal task management in Redstone Cowork, the linked platform that have that task like JIRA will also be updated (if the task is linked)
- The tasks added to user's backlog wont just simply sync from their sources, but we also ensure clarity by breaking them down into actionable steps. If we are uncertain of what to breakdown, at least we should give them the first few step to clearly execute and get started on the problem
- User can connect the agent to any claude code of them running on any server / computer (some user use different servers to code). But this will work session based only, a new session of claude code on anywhere (servers/pcs) they start wont be connected to the system right away, which mean we can create a command for the user to run and it will auto hook that claude session to Redstone Cowork server. Whenever Claude done a task, we will send noti to the desktop app, the phone app and allow them to select the continous action like what decision to make (better be multiple choice + custom reply). So if the user click on one option on noti then it will auto answer that claude code session running from anywhere in the user's machine or server. Best things is if the user has an apple watch, they can view the summary of the claude code work result, or question and plan, and click or speak their answer anywhere anytime without missing out
- User can connect to their Google Drive account and have the agent to interact search, read the files to gather context
- On first time (user can re do this anytime) user can do a learning session by connecting to their jira, their mattermost, email,... then have the agent to pull everything in the last 1 month, and it will start to understand and map out their projects, their entities so new things comming in they know what group to put to or create new entity/project. Also creating a profile of the user to understand about themself
- Fictional employees and characters with different personalities will be created to work on the user's different projects, and a group chat also created for each project. With PMs, Devs and other roles needed for that what project on whatever they are working on. Each with personalities and will give their opinion when needed, or autonmous when feels appropriate. For example, when a Claude Code session running and it need a decision on how would approach feature X. The team member in that project (virtual) will start pinging user (which is the boss), PM will give his opinion based on project timeline, risk,... Engineer will give his opinion about the technical aspect, what is best. UI/UX will give opinion about the user experience... And whenever the user replied to them and make the final call (which the PM will confirm) the command will be send back to the Claude Code session automatically without having that user having to log in to their computer or server to type it in and enter himself
-The user, however can fast track decision by have a "Situation Room" UI interface to monitor all running project with activities, status updates, notification, and decision that need their attention or approval, with summary and suggestion, so they can select quick response or type in custom response to each agents/claude code decision waiting. Just form their mobile app
- The agent will have a gateway and hook to talk to its mother company (which is the user's real company that they are not the CEO), so the mother company can easily pull the user's time spent, task status, what strategy and action taken, productivity, etc...
- With access to the user's calendar, the assistant team will automatically plan ahead events for user, update events, and have them prepared for those event actively. Example before meeting with the mother company's manager about project X, the assistance team auto pulls latest updates, tasks, claude code session history,... to give them a summary of what to report, what questions to ask the manager, etc... 3 hours before the meeting. Every night before user go to sleep about 9PM the assistance team give planning for the next day and confirm with them, optimize their schedule, work block, times for family and personal. 5 AM they give brief about that and remind user of what to do.

# Design

https://dribbble.com/shots/26193823-Quantum-Glide-Futuristic-AI-Driven-Transport-UI-Concept

We use futuristic, elegant, liquid glass design for this software, with motion.dev's animation (for web and desktop, for mobile if we can use them great if not then adapt)

# Technology

- Postgre for database, Qdrant for anything that needs vector
- LangChain, LangGraph, DeepAgent will be used for chatting, simple LLM task, conversationtional
- Memory using mem0
- Claude Code SDK will be called for complex task that need CLI like deep research.  internet, coding, handling powerpoint, word, excel files, etc... It must also report back in a hook to conversational agent so they can keep their boss which is the user updated (for example, first user say, research me way to do this, conversational agent answer "ok let me do it, I will circle back to you when done..." then call the Claude Code SDK, when user waited and ask "Hey how it is goin with the research" conversational agent will pull latest update from Claude SDK and say "Hey im already done researching compioling to a docx report for you". And if Claude SDK have more questions, the conversational need to ask the user as well for answers, actively)
- NextJS & NestJS with shared Zod, Postgre
- React Native
- Other things might needed

# Approach
- Project designed in hexagon architecture
- All system prompt must not be stored in code but seprated in folders with .md extension and loaded in using jinja
- 
# Prioritize in MVP
- Claude Code hook and notification
- Connection to Jira, Mattermost, Github, Gmail, Outlook, Calendar
- Task sync and breakdown feature
- "Situation Room" interface
