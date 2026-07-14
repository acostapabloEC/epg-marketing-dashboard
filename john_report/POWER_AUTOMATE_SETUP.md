# Teams DM to John — one-time setup (free, ~5 minutes)

This makes John get the engagement table as a Teams direct message, in addition
to the email. You set up a small "robot" (a Power Automate flow) once. It watches
your inbox, and whenever the report email goes out, it posts the table to John on
Teams. No paid add-ons, nothing to paste into the buttons.

## How it works (plain version)
1. You click "2 - SEND TO JOHN" → it emails the table to John AND drops a copy in YOUR inbox.
2. The flow sees that email arrive in your inbox.
3. It posts the same table into your Teams chat with John.

## Build the flow

1. Go to **https://make.powerautomate.com** and sign in with your ECP account.
2. Left menu → **Create** → choose **Automated cloud flow**.
3. Name it `John LinkedIn Teams DM`.
4. In "Choose your flow's trigger," search **email** and pick
   **"When a new email arrives (V3)"** (Office 365 Outlook) → **Create**.
5. On that trigger, click **Show advanced options** and set:
   - **Subject Filter:** `Frank LaRosa LinkedIn — Weekly Engagement`
   - **From:** `pabloacosta@eliteconsultingpartners.com`
   - **Include Attachments:** No
   (The subject filter is what makes it fire only for this report.)
6. Click **+ New step** → search **Teams** → pick
   **"Post message in a chat or channel"** (Microsoft Teams).
   - **Post as:** User
   - **Post in:** Chat with user
   - **Recipient:** start typing John and pick
     `JohnSchreppler@eliteconsultingpartners.com`
   - **Message:** click in the box, open **Dynamic content**, and insert **Body**
     (this is the email's table). 
7. Click **Save**. Done — the robot is live.

## Test it
1. Double-click **`1 - PREVIEW`** to see the table.
2. Double-click **`2 - SEND TO JOHN`**.
3. Within a minute John should get the email and the Teams DM. (Check your own
   Teams too — the copy goes to the chat between you and John.)

## Notes
- The flow only fires on emails with that exact subject, so your other mail is untouched.
- John gets BOTH the email and the Teams DM — that's intended.
- To pause Teams without touching anything else: turn the flow Off in Power Automate.
