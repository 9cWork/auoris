# Privacy Policy

This policy explains what {{operator}} ("we", "us") collects when you use Auoris, why, who sees it and what control you have. It covers the desktop app, phone app, browser extension, Minecraft client, the website at auoris.org and the online services.

## 1. The short version

- Chats with AI models you run **locally** stay on your computer.
- If you make an account, the things you choose to put online (profile, messages, files, servers, friends) are stored on our servers so they can be delivered to the people you share them with.
- We do not sell your personal information and we do not show ads.
- Crash reports are **off by default** and only sent if you turn them on.

## 2. What stays on your device

Auoris Pets (optional, off until you adopt one and accept the warning) keep each pet's settings, memories and its last 60 analyses (with the prompt you typed) on your computer only, under your account's folder; you can see, correct, export and delete every memory, and deleting all memories also deletes those analyses. Nothing is kept from incognito chats. While a pet is active, the text of each prompt you send (plus up to 8 relevant memories, never the rest of your chat or your files) is sent to the AI model you chose for that pet, which can be a cloud provider, and is handled under that provider's own terms; this uses extra AI usage. Pets never store passwords, keys, contact or financial details, and you can switch learning off, also for a single message. Connectors (MCP servers) you add run on your computer or at the address you give; Auoris does not receive anything you send to them, and what a connector returns is passed to the AI model you chose like any other message. Local AI chats, your project folders, settings, downloaded models, the Minecraft game folders, mods you add, starred messages and your encrypted API keys live on your computer (in `%APPDATA%\Auoris` and the folders you choose). API keys are encrypted with Windows. We don't receive them, with one exception: if you set a shared key for an AI Project, we store that key encrypted in our database vault so the project's AI can answer for it, and you can remove it at any time. If you use a cloud AI provider with your own key, your prompts go straight from your device to that provider under their privacy policy.

## 3. What we collect when you have an account

- **Age check:** when you sign up we ask for your date of birth only to check that you are old enough. We do not store it.
- **Account details:** email address, username, display name, password (stored as a salted hash by our authentication provider, never in plain text), and, if you use Google, Microsoft, GitHub, Discord or Twitch sign-in or link one of those accounts, the basic profile details they share with us (such as your email and name).
- **Profile:** avatar, banner, bio, pronouns, colours, effects, badges and your Plus status.
- **Linked accounts:** which sign-in providers are linked to your Auoris account is kept by our authentication provider. Only if you switch it on for GitHub, Discord or Twitch, the public name that provider verified for you is copied to your profile and shown to other people; unlinking the account or switching it off removes it. Google and Microsoft names are never shown.
- **Social data:** friends, friend requests, blocks, mutes, group memberships, server memberships, server roles, banners and Sparks you give to servers.
- **Messages and files:** direct messages, group and server messages, reactions, pins, polls, activities and the files, images and GIF links you send. Files are checked automatically for known malware signatures and disguised executables (this is not a full antivirus scan) and kept in private storage; links to them are signed and expire.
- **Presence:** whether you are online, and, if you allow it, what game you are playing so friends can see it. For some games Auoris reads that game's own log files on your computer to find the server address (for Minecraft) or the game place and server id (for Roblox), and shares that with your friends so they can join you. You can turn this off in Settings, and Auoris reads only those logs for that purpose.
- **Minecraft accounts in use:** when you play Minecraft through Auoris, the name and ID of each Minecraft account running on your Auoris account is stored (never a password or token) for up to 60 days. You and Auoris administrators can see it. It lets moderators tell a player's alternate accounts apart when enforcing the rules, for example against ban evasion.
- **Minecraft:** if you use the Auoris Minecraft features and share cosmetics, we store your Minecraft username, the cosmetics you picked, the emote you are currently playing and when you were last online so other Auoris players can show your logo, cosmetics and emotes. You can turn sharing off.
- **Minecraft account ownership:** when you play with a Microsoft-signed-in Minecraft account, the app sends that account's Minecraft access token to our server once a week, which asks Mojang whose account it is and then forgets the token. We store which Minecraft account id belongs to your Auoris account, so nobody else can show Auoris presence for your player. It is kept until your Auoris account is deleted or someone else proves they own that Minecraft account.
- **AI projects:** messages in an AI project are visible to its members. When a member asks the AI (by typing @ai), the recent project messages are sent to the AI model that member has chosen in their own Auoris app: their own computer for a local model, or the cloud provider they set up with their own key (which then handles the text under its own terms). The answer is posted to the project as a normal message from that member.
- **Billing:** when you buy Plus, Stripe collects your payment details. We receive a customer id, subscription status and dates, not your card number.
- **Safety and abuse:** reports you send, moderation actions and technical records (for example rate-limit counters) used to keep the Service safe. Reports about messages are kept after the reporter or the reported person deletes their account, for as long as needed to handle the report and protect people. We also keep a private security log of changes to an account's standing (bans, staff roles and Plus status) and of staff actions (in-game moderation actions aimed at a player, and announcements): which account was affected, what happened, when, and which staff account or system did it. It is used only to investigate misuse of accounts or staff powers, nobody can see it in the app, and entries are deleted after 12 months. Some of these changes (a staff role given outside the Owner's own account, or many bans in a short time) also create a short alert that only the Owner can see, deleted after 90 days.
- **Network identifier (for safety):** when you are signed in we record, for the last few networks you used, a keyed one-way hash of your IP address (never the address itself, and it cannot be turned back into one). It is used only to enforce bans: an administrator can block an account's networks from creating new accounts, and a server owner or moderator can ban a member from their server and, if they choose, block that member's networks from joining that server again. Nobody, including administrators and server owners, can see an address or the hashes; they only see which account was banned. IPv6 addresses are reduced to their network (/64) before hashing. These records are deleted with your account; a hash created by a ban is kept for as long as the ban applies, even if the banned account is later deleted, so that the ban cannot be undone by deleting the account. For the same reason, while an account is banned we keep a keyed one-way hash of its email address (never the address itself, including any address it changes to while banned), so a new account cannot be created with that address; it is kept if the banned account is deleted and removed if the ban is lifted.
- **Calls:** voice and video calls between friends are peer-to-peer: audio and video go directly between your devices and are not stored by us. To set a call up, our servers pass short-lived connection details between you (these contain your network addresses and are deleted within minutes), the other person's app can see your IP address, and a public STUN server run by Google is contacted to work out your public address.
- **Defaults:** presence and Minecraft sharing are on by default; you can turn both off in Settings. While you are in a Minecraft game with sharing on, any signed-in Auoris user can see your Minecraft name and cosmetics for the few minutes after your last update.
- **GIFs:** GIF searches go through our server to Giphy. GIFs you see are loaded straight from Giphy's servers, so Giphy sees your IP address. GIFs you favourite are stored in your account.
- **The in-game /ai command:** your question, and a screenshot of your game when you ask about what you see, are sent to the model you chose in Auoris. If that is a cloud provider, they receive them under their own privacy policy.
- **Auoris Extra and the other multi-model modes (/extra, /team, /split, /debate, /divide, @agents, sub-agents the AI starts in Code mode, and Auto mode when you switch it on and it picks one for a message):** your request (with any attached files, and for an @agent the last few messages of the chat) is sent to several models so they can draft, review, plan or debate: the one you selected, the other providers you have connected (or chose with /extramodels or for that agent), and your local models. Each cloud provider receives it under its own privacy policy. In private mode a local model first removes personal details, and the cloud models only receive that edited version. The drafts and reviews are shown under the answer and saved with that chat on your computer only; they are not sent to models again later. An @agent's memory (short notes it keeps between chats, which you can edit or clear in /agents) is stored on your computer and sent only to that agent's model with your questions to it. Agent share codes contain an agent's name, model and instructions, never its memory.
- **Usage and costs:** the token counts and estimated costs shown in Usage, your prices and your daily cloud budget are kept on your computer only.
- **Chat import (/import):** Auoris reads chat history that is already on your computer (Claude Code, Codex and Gemini CLI histories, and ChatGPT or Claude data-export files you downloaded) and copies it into your local Auoris chats. Nothing is uploaded, and Auoris never signs in to those services.
- **Chat from anywhere (phone relay):** if you turn this on, the chat you type on auoris.org and your PC's answers pass through our realtime service between your own signed-in devices. They are not stored, and only your own account can use that connection. Your PC's AI handles the chat as described above for local models and cloud providers.
- **Uploads quota data:** the size and time of your uploads, used to apply upload limits.
- **auoris.md:** if you create an auoris.md file (in a project folder, or your own one in `%APPDATA%\Auoris`), its text is added to the instructions of each chat in that folder, so it goes to the model you use there - your local model, or a cloud provider under its privacy policy. The file stays on your computer; we never receive it.
- **Crash reports (optional):** if you switch this on, an error message, a trimmed technical trace with your user folder, file paths and e-mail addresses removed, the Auoris version and your Windows version.

We do not collect your browsing history, and the browser extension only sends a page to Auoris when you press its button.

## 4. How we use it

To provide and secure the Service (sign-in, delivery of messages, syncing, search, friends, the phone pairing), to take payments and give Plus, to detect abuse and enforce our rules, to fix bugs, to comply with the law and to answer your questions. We do not use your private messages to train AI models.

## 5. Who we share it with

- **People you share with:** whatever you send or show is visible to the recipients and, for servers and profiles, to the people who can see them.
- **Service providers** who help us run Auoris, under contract: Supabase (database, sign-in, storage, realtime), Stripe (payments), GitHub (software updates and website hosting), Cloudflare (content delivery and security), Giphy (GIF search, requested through our servers), and Google, Microsoft and GitHub if you choose them to sign in. Mojang and Microsoft provide Minecraft sign-in directly to your device.
- **Legal and safety:** we may disclose information if the law requires it, to respond to valid legal requests, or to protect someone from serious harm or to protect our rights.
- **Business changes:** if the Service is transferred to someone else, your information may go with it under this policy.

## 6. Where your data is processed

Our providers may process data in the United States and other countries. Where the law requires it, we rely on approved safeguards for international transfers.

## 7. How long we keep it

We keep account data while your account exists (network hashes are limited to your last few networks).  Messages and files stay until you or the other participants delete them or the account is deleted. When you delete your account we delete or anonymise your profile and content within a reasonable time, apart from what we must keep for legal, billing or abuse-prevention reasons. Crash reports are kept only as long as needed to fix the bug, and are deleted with your account.

## 8. Your choices and rights

You can edit your profile, change who can message or add you, block and mute people, turn off presence and Minecraft sharing, turn crash reports on or off, delete messages and files, and delete your account (Account & security). Depending on where you live (for example the EEA, the UK or California) you may have the right to access, correct, delete, restrict or export your data, to object to some processing and to complain to your data protection authority. To use these rights contact {{contact}}. We will not treat you worse for using them.

## 9. Security

Data is sent over encrypted connections, access to the database is limited by per-user rules, passwords are hashed and your API keys are stored encrypted on your device. Messages are not end-to-end encrypted. No system is perfectly secure, so please use a strong, unique password.

## 10. Children

Auoris is not for children under 13 (or the higher age required where you live). If you believe a child has given us personal information, contact {{contact}} and we will delete it.

## 11. Cookies and local storage

The website uses your browser's local storage for things like your theme, last-seen markers and sign-in session, and a service worker that caches the site's own files so it loads faster. We don't use advertising or cross-site tracking cookies. The desktop app does not use cookies for tracking.

## 12. Changes to this policy

When we change this policy in a way that matters, the version date changes and the app and website ask you to read and accept the updated documents before you carry on.

## 13. Contact

{{contact}}

*Version {{version}}.*
