// "What's new": shown once after the app updates, and any time from the question mark at the top.
// Add the new version at the top of CHANGES with each release.

const CHANGES = [
  { version: "2.33.0", items: [
    "New Comments page (under Channel stats): every comment on your YouTube channel in one list, the ones you haven't answered on top. The number on the side bar shows how many wait for you.",
    "Answer right there: click Answer, type, and press Send (or Ctrl+Enter). The next comment opens by itself, so you can go down the list fast.",
    "Quick answers: save answers you use a lot, like \"Thanks for watching!\", and add them with one click.",
    "When someone answers you back, the comment comes back to the top. Press Done on ones you don't want to answer.",
    "Pick one video, search the comments, let through comments YouTube held back, or hide spam from your channel.",
    "It uses the same Google sign-in as Channel stats. The first time, Google asks one more time so VaultHub can post your answers. It's free.",
  ] },
  { version: "2.32.1", items: [
    "Fixed Customize on Home: the widgets, their buttons and the \"Add a widget\" list look right again (they showed up as big gray boxes).",
    "Customize is tidier: each card gets a small set of buttons in its corner instead of a second title.",
  ] },
  { version: "2.32.0", items: [
    "Stream alerts: when a friend goes live on YouTube or Twitch, you get a ping in the bell, and a Windows notification if the app is behind other windows. Click it to watch.",
    "Who's live right now shows at the top of Home, with the stream's picture, title and how many are watching. Their profile shows it too.",
    "Put your Twitch next to your YouTube channel in Account > Edit profile, so your friends get a ping when you go live.",
    "Don't want the pings? Turn off \"Friends going live\" in Settings > Notifications.",
    "Home is yours now: click Customize to drag widgets around, make them wide or narrow, take them off, or add new ones: Calls, Game sales, Your channel, Recent docs, Due on your boards and Notifications. Each account keeps its own layout.",
    "Files: drop a whole folder (or click \"choose a folder\") to convert everything inside it, subfolders too.",
    "New Watched folders in Files: pick a folder, like where OBS saves recordings, and anything new in it gets converted by itself while VaultHub is open.",
  ] },
  { version: "2.31.0", items: [
    "New themes in Settings: Dim (a softer dark gray) and Warm (cozy brown tones), next to Dark, Black and Light.",
    "Pick any color you like for the buttons and highlights, not just the ready-made ones.",
    "Put your own picture behind every page in Settings > Background. It sits under a soft shade so text stays easy to read.",
    "Chat: answer a message with Reply (it shows what you answer, and a click on it jumps there), or start a thread under a message for a side talk that doesn't fill up the chat.",
    "Pin important messages with the pin button. The pin at the top of a chat shows them all. In the chat with everyone the owner and admins can pin; in groups and private chats everyone can.",
    "Voice messages: click the microphone, talk, and send. Play them at 1x, 1.5x or 2x, and click the waveform to skip ahead.",
    "React with any emoji (there's a search), edit your own messages (or press the up arrow), and delete them like before.",
    "GIFs and stickers: paste a GIPHY or Tenor link, send a GIF from your PC, or pick a sticker like GG, W or LET'S GO. Star GIFs to keep them for later.",
    "Links show a card: YouTube videos and Steam trailers play right in the app, and other pages show their title and picture.",
    "Search a chat for old messages (Ctrl+F), and scroll up to read further back than before.",
    "Set your status at the bottom left: Away, Busy, Recording, Editing, Gaming or Streaming, plus a short line like \"Editing ep 4\". Friends see it next to your name.",
    "Polls: click + next to the message box, ask a question, and everyone votes. You can let people pick more than one answer and end the poll when you're done.",
  ] },
  { version: "2.30.0", items: [
    "New how-to-use tour: it now shows everything added lately, like the Resolve tab, calls, profiles, Boards and Games, POVs and Film assets, Channel stats, Titles & tags and Ctrl+K search. It pops up once after this update, and you can watch it again from the question mark at the top (turn the voice on for a friendly walkthrough).",
    "Calls: click a friend's picture in a call to turn them down or up (to 200%). It's remembered for next time, and you also see how good their connection is.",
    "Signal bars on everyone in a call, and calls hold up better on bad Wi-Fi: sound stays smoother and a dropped connection comes back faster.",
    "Push to talk: pick any key or mouse side button in the call's settings or Settings > Sound. It works while you're in a game too.",
    "Sound board: the new button in a call plays Library sounds for everyone. Your favorites come first.",
    "Record a call: the red button saves everyone's voices as an MP3 in your save folder. Everyone in the call sees that it's being recorded.",
    "Share your PC's sound with your screen, so friends hear your game or music too.",
    "The Friends page is taken out for now, so the side bar is back to how it was (Ctrl+1 to 9 go to the same pages as before 2.29.0).",
  ] },
  { version: "2.29.0", items: [
    "New Friends page (right under Home): see what your friends made and did, newest first, by day. New YouTube uploads, POVs they shared, games they posted, want to record, started recording or finished, sounds they added to the Library and changes on your team boards.",
    "Click a video to watch it (or Download to get it as MP3 or MP4), a game or board to open it, a sound to play it, and anyone's face to see their profile. Click a face at the top to see only what that person did.",
    "Pick Today, This week or the last 2 weeks, filter by Videos, POVs, Games, Sounds or Boards, and turn on Mine too to see your own stuff as well.",
    "The side bar shows how many new things your friends did. New videos from friends and games they start or finish recording also show up under the bell (turn it off in Settings > Notifications).",
    "On someone's profile, See activity opens the Friends page with only them. Friends' videos show up once they add their YouTube channel on their profile.",
    "Calls sound much better: voice now goes at 128 kbps by default (about 4 times what calls used before), and your voice goes first when the internet is busy, ahead of shared screens and cameras.",
    "Pick your own sound quality, from 32 to 510 kbps, in the call's sliders menu or Settings > Sound. It changes right away, even in the middle of a call.",
    "New Music mode: stereo sound with no cleanup, for music, singing or game sound through your microphone. Use headphones with it.",
    "New Titles & tags page (under Tools): type your title and get a score with tips, see how it looks on a phone and in search, get other ways to say it, and grab the tags and hashtags the top YouTube videos for your topic use.",
    "Compare two videos: in Channel stats, put two of your videos (or any YouTube link) side by side and see views, views a day, likes and comments, with the better one lit up and a short summary. Signed in with Google you also get watch time, how much people watched, and their first 30 days as a graph.",
  ] },
  { version: "2.28.0", items: [
    "Notifications: a new bell at the top shows everything new in one place: messages and @mentions, invites to docs and boards, games on sale, new POVs from friends, finished downloads and app updates. Click one to go straight there.",
    "New things also pop up as a little card in the bottom corner, and as a Windows notification when VaultHub is behind other windows or minimized. Click it to jump right in.",
    "Need quiet? The moon button under the bell turns on do not disturb for an hour. Pick what can notify you in Settings > Notifications.",
    "Side bar: click a group's name (Convert, Create, Tools) to fold its pages away, and click again to bring them back. VaultHub remembers it. The page you're on always stays visible, and a folded group shows a dot when something inside is new.",
  ] },
  { version: "2.27.0", items: [
    "New Channel stats tab (under Tools): paste your channel link to see your subscribers, views, newest uploads with likes and comments, how each one does next to your usual, and your top videos. A graph fills in day by day.",
    "Want more? Sign in with Google on the Channel stats tab to see watch time and where your viewers come from (search, Shorts feed, suggested videos). The tab walks you through the one-time setup.",
    "Find music: the Library's Find sounds window (now Find sounds & music) has a Music tab. Pick a mood like Chill or Epic, listen, and download copyright-free songs or add them to the Library. 'Safe for monetized videos' is on by default, and songs that need credit have a Copy credit button for your video description.",
    "Search everything: press Ctrl+K (or click Search at the top of the side bar) to jump to any page, document, board or game. Paste a link in it to convert it right away.",
    "Keyboard shortcuts: Ctrl+1 to 9 go to the pages in the side bar, Alt+Left and Alt+Right (or your mouse's side buttons) go back and forward, Ctrl+N makes something new on the page you're on, and Ctrl+, opens Settings.",
    "Press Ctrl+/ (or find Keyboard shortcuts under the ? button) to see every shortcut in the app.",
  ] },
  { version: "2.26.1", items: [
    "Library: the waveform in the player at the bottom shows again on smaller windows, and so do the small ones in the list.",
    "The player bar fits small windows now, so the volume slider no longer runs off the edge.",
    "The Library opens about 3 times faster, and a waveform that can't load stops blinking.",
    "Popups and the tour fit better on short windows, and Docs scrolls a bit smoother.",
  ] },
  { version: "2.26.0", items: [
    "Profiles: click anyone's name or picture (in the chat, Boards, Games, POVs, Docs, the Library and calls) to see their profile.",
    "A profile shows their banner, bio and status, whether they're online or in a call, their newest YouTube videos (they play right in the app), and the games, POVs and sounds they shared.",
    "Message, call or invite a friend to one of your team boards straight from their profile.",
    "Make yours: on the Account page, pick a banner, your color, a status line, a few words about you and your YouTube channel, and choose what friends can see.",
    "Check for updates: when you click Check now in Settings and there's a new version, Settings closes so you can see the update right away.",
  ] },
  { version: "2.25.0", items: [
    "Watch videos right here: clicking a friend's new video now plays it inside VaultHub instead of opening your browser. Press Esc or the X to close it.",
    "Slow motion or faster: pick a speed from 0.25x to 2x under the video. The gear button in the player also has the quality.",
    "Works on Home (newest uploads and activity), on the Stats page and in Games (the video you made, and the YouTube videos about a game).",
    "If a video's owner only lets it play on YouTube, you get a button to open it there instead.",
    "Settings > Sound: pick your speakers or headphones and your microphone, test them, and choose noise suppression. Calls use the same choices, and the app's sounds play on the speakers you picked.",
  ] },
  { version: "2.24.3", items: [
    "Fits small screens: on a laptop or a small window, the side bar names (Convert, Create, Tools) are no longer cut in half.",
    "Home: the newest uploads line up neatly on smaller screens, and the Watch and Convert buttons stay inside their cards.",
    "Docs, Resolve, Library, Games and Film assets also make better use of the room on small screens, so nothing gets squashed or cut off.",
  ] },
  { version: "2.24.2", items: [
    "Calmer side bar: the highlight no longer stretches and wobbles when you switch pages.",
    "It slides quickly to a page close by, and simply fades in on a page further away instead of flying past everything.",
  ] },
  { version: "2.24.1", items: [
    "Smoother Library: with lots of sounds, typing in search used to stutter. Now it stays smooth, and the Library opens faster.",
    "History opens faster when you have a long list of downloads.",
    "The side bar does less work in the background (it looks the same), so everything moving on the page has more room to stay smooth.",
    "Resolve: the Add a video button was squashed flat. It's a proper button again.",
  ] },
  { version: "2.24.0", items: [
    "New Resolve tab (beta, still being worked on): add a video, watch it right away, then pick what VaultHub should do with it.",
    "Subtitles: VaultHub listens to the speech and writes it down, all on your PC (on an NVIDIA graphics card it's many times faster). It finds the sound track with your voice, learns names you type in, and lines up each line with when you really talk.",
    "Read along with the video in VaultHub, fix words and nudge lines, then click Put in Resolve. In Resolve, File › Import › Timeline gives you your video with every subtitle as Text+, ready to style and animate.",
    "Cut the silence: makes a timeline without the quiet parts (every cut can still be changed in Resolve), or a new video if you like.",
    "Fix for Resolve: videos from OBS, games and phones become a .MOV that Resolve edits smoothly, with the sound in sync and every sound track kept separate.",
    "Project folder: make a folder for your video with Footage, Audio, VFX and more. While it's on, the things you download or make in VaultHub land in the right place.",
    "Boards: use your own picture as a board's background. Open the board's menu, then Change background, and click + or drop a picture there. On team boards everyone sees it.",
    "Boards: delete a board for good right from its tile on the Boards page (hover it and click the bin), or from the board's menu.",
  ] },
  { version: "2.23.0", items: [
    "Docs: editing a PDF works better with any PDF. Icons made of several parts (like a person icon) are now picked up as one piece, and picking something up never changes how it looks.",
    "Text you change takes the same room as the old text, so the line doesn't shift, and bold words in a line stay bold.",
    "The PDF toolbar got a cleaner look: it's solid, the labels have room, and Copy and Delete for pictures are up there now.",
  ] },
  { version: "2.22.1", items: [
    "Faster and smoother all over: the Film assets tab uses far less power while it sits there, and the app checks for news less often when it's minimized.",
    "The app reuses its own files instead of loading them again, and Docs, PDF editing and the Library do less work while you type, drag or play.",
    "Boards: dragging cards no longer drops the wrong one, and a friend's edit no longer throws away what you're typing.",
    "POVs: only friends you sent a video to can download it, and cancelled or expired downloads clean up after themselves.",
    "Lots of smaller fixes in Docs, Games, Film uploads and calls.",
  ] },
  { version: "2.22.0", items: [
    "POVs: friends pass videos on. Once you've downloaded a video, you can send it to others too, while VaultHub is open and its timer runs.",
    "So when the one who recorded it has their PC off, you can still get it from a friend who already has it. The card says who is ready to send.",
  ] },
  { version: "2.21.1", items: [
    "POVs is simpler: click \"New video\", give it a name, pick how long it stays up, choose the file and click Save. No sessions to make first.",
    "All the videos are in one list, newest first. A download is saved with the name it has in the list.",
  ] },
  { version: "2.21.0", items: [
    "New POVs tab: recorded a game together? Make a session, and everyone adds their own recording so the others can download their POV.",
    "Nothing gets uploaded, so it's free and any size works: the video goes straight from your friend's PC to yours. They need VaultHub open while you download (a green dot shows when they're ready).",
    "When you add your POV you pick how long it stays: 1 hour, 6 hours, 1 day, 3 days, 1 week, or until you remove it. Then it's gone from the tab by itself (the video stays on your PC).",
    "A download that stops (internet gone, app closed, or you clicked Pause) goes on from where it was.",
  ] },
  { version: "2.20.0", items: [
    "Docs: in a PDF you can now edit everything, not just the text. Click an icon, a dot (like the rating dots on a CV) or a picture to pick it up.",
    "Then drag it somewhere else, give it a new color, make it bigger or smaller with - and +, copy it or delete it. Two new grays are in the colors, handy for \"empty\" rating dots.",
  ] },
  { version: "2.19.2", items: [
    "Docs: in a PDF you opened \"just as it looks\", text you already changed can be clicked and changed again. Before, clicking back into it sometimes did nothing.",
  ] },
  { version: "2.19.1", items: [
    "Docs: centered (and right-side or indented) lines stay that way when you go to another page and come back, and when you save. Lines that already lost it need to be centered once more.",
  ] },
  { version: "2.19.0", items: [
    "Docs: a PDF can now open just as it looks, like in Edge. When you import one, pick \"Keep how it looks\" and click any text to change it.",
    "You can also add new text, draw, highlight, erase and add pictures on top of the PDF, then click \"Download PDF\" or print it.",
    "Want normal text you can restyle freely instead? Pick \"Turn into a document\" when you import, or use Tools > \"Turn it into a normal document\" later.",
    "PDF imports that turn into a document got better too: two-column pages (like a CV with a sidebar), bold text, numbers and centered lines come out right more often.",
  ] },
  { version: "2.18.0", items: [
    "Docs: you can import a PDF now. Click \"Import a PDF\" on the Docs page (or drag a PDF onto it) and it turns into a normal document you can change however you like: text, headings, lists, tables and pictures.",
    "Movie scripts in a PDF come in as a real script, with scenes, characters and dialogue in the right places.",
    "Inside a document, File > \"Import a PDF as a page\" adds a PDF as a new page.",
    "It all happens on your computer, nothing gets uploaded. A scanned PDF (a photo of paper) comes in as a picture, since there's no text in it to edit.",
  ] },
  { version: "2.17.4", items: [
    "Docs: changing the text size on an empty line (or with just the text cursor somewhere) works now. Before, the size jumped back, for example to 48 under a big title, and what you typed came out the wrong size.",
    "Docs: double-clicking the size box to pick the number no longer makes the new size go nowhere.",
  ] },
  { version: "2.17.3", items: [
    "Docs: copying a centered (or right-side) line and pasting it on another page keeps it centered. Before, it showed up on the left while the buttons said it was centered, and you couldn't change it. Lines that already got stuck like that fix themselves when you open the document.",
    "Docs: copied text no longer brings the page's colors and font along, so it matches the rest of your document.",
    "Settings: the X in the corner works when you click right in the middle of it.",
  ] },
  { version: "2.17.2", items: [
    "Bug fixes: a change on a board is no longer lost if you close the board right after making it (or close the app). If saving fails for a moment, it tries again by itself.",
    "Games without a picture now still show their Recording, Done and sale tags.",
    "Games are smoother: the list doesn't redraw itself every 30 seconds when nothing changed, the \"New sale!\" tag pulses without slowing the page, and games Steam can't read aren't asked about over and over.",
    "Film assets: clips added right as the app finished the last one could get stuck on \"waiting\". Fixed.",
    "Calls let go of everything properly when they end, so many calls in a row don't slowly use more of your computer.",
    "Home opens a bit faster.",
  ] },
  { version: "2.17.1", items: [
    "Game prices in the Games tab are always in Norwegian kroner (NOK) again, no matter who posted the game. Older games switch over by themselves.",
  ] },
  { version: "2.17.0", items: [
    "Sale alerts in Games: when a game in your list goes on sale (or turns free), the Games tab gets a little number and a banner shows you which ones. Cards get a \"New sale!\" tag.",
    "Watch the Steam trailer right inside the game window, before the pictures.",
    "YouTube check: see how big a game is on YouTube (how many views gameplay videos get) and sort the list by \"Biggest on YouTube\".",
  ] },
  { version: "2.16.0", items: [
    "New Games tab! Paste Steam links of games you might record for YouTube, and they show up as cards with the Steam picture, price, description and reviews.",
    "Paste a whole bunch of links at once (straight from Discord) and add a note about why you posted a game.",
    "Give a thumbs up to games you want to record, and mark each game as Idea, Recording or Done. When it's done, add the YouTube link.",
    "Open a game to see its pictures, talk about it with your friends and open it in Steam. Filter by Free, On sale or Co-op, and see sales right away. Prices update by themselves.",
  ] },
  { version: "2.15.0", items: [
    "New Film assets tab, like ActionVFX! Explosions, fire, smoke, sparks, muzzle flashes and more, in packs you can share with your friends.",
    "Put your mouse on a pack to watch its preview, open it to see every clip, and download the whole pack or just one clip, ready to drop into Resolve or Premiere.",
    "The owner and admins make packs with + New pack and drop clips in. The app makes the previews by itself, and big files are fine.",
    "The clips go in the owner's own free Backblaze storage (10 GB free). The owner sets it up once in the Film assets tab.",
  ] },
  { version: "2.14.0", items: [
    "Smoother everywhere! Folding the side bar is now one clean move: the icons stay put, the names fade and the highlight glides along.",
    "Fixed the highlight sliding down from the top when you resize the window.",
    "Switches now use your color instead of green, so everything matches.",
    "Tidier Boards and Home: new dashed \"Create new board\" tiles, matching Log in buttons, and a calm grey dash while the channels load.",
  ] },
  { version: "2.13.0", items: [
    "Turn on your camera in calls with the new camera button. Everyone in the call shows up as a tile, and a green outline shows who's talking.",
    "When someone shares their screen, the cameras sit in a row under it. Make it all small in the corner any time.",
    "AI noise suppression: keyboard clicks, fans and background noise get taken away, so only your voice comes through. It's on by default.",
    "Pick how strong it is (Off, Standard, Strong or Max), and which camera to use, with the sliders button in a call.",
  ] },
  { version: "2.12.0", items: [
    "New Boards tab, like Trello! Make boards with lists and cards, and drag the cards along as things get done. Start empty or with a ready setup, like YouTube video.",
    "Open a card to give it labels, a due date, a description, checklists, links, a cover color and comments. Use the pencil or right-click a card for quick changes.",
    "Team boards: pick Team when you make a board and invite your friends. They get an invitation in their Boards tab, and everyone's changes show up for the others in a few seconds.",
    "On team boards you can put people on cards, see who's looking at the board right now, and filter to only your cards.",
    "Boards that are Just me stay on your computer, and nobody else can see them.",
  ] },
  { version: "2.11.0", items: [
    "Group calls! Press Call in a group chat and everyone online can join. Already a call going? The button says Join call. Up to 9 people.",
    "See who's talking: a green ring lights up around their picture.",
    "New Deafen button: you hear nobody and nobody hears you. Everyone can see when someone is muted or deafened.",
    "Pick your microphone and your speakers or headphones with the sliders button in a call. The app remembers them.",
    "Screen sharing got options: pick 360p up to 1440p and 15, 30 or 60 fps, switch to another screen with Change screen, and pick whose screen to watch when more than one person shares.",
  ] },
  { version: "2.10.0", items: [
    "Calls! Open a private chat and press Call at the top to talk to your friend.",
    "Share your screen in a call: press the screen button and pick a window or your whole screen. Their screen opens big, and you can make it small or full screen.",
    "Someone calling you? A card pops up with Answer and Decline, even when the chat is closed, and the app blinks in the taskbar.",
    "Mute yourself any time, and see how long you've been talking. Missed calls show up in the chat with a Call back button.",
  ] },
  { version: "2.9.0", items: [
    "Playlists in the Library! Make your own lists of the sounds you use most. Only you can see them.",
    "Click the new playlist button on any sound to put it in a playlist, or to make a new one right there.",
    "Invite friends to a playlist: they can see it and add sounds to it too. Rename it or delete it any time.",
    "Press Play on a playlist to start it, and skip through its sounds with the player bar.",
  ] },
  { version: "2.8.0", items: [
    "Folders in Docs! Press New folder to keep a project together, and put folders inside folders too.",
    "Drag a document onto a folder to put it in there, or use ··· and Move to folder.",
    "Keep everything for one film in one document: press + above the page and add a movie script, a shot list or notes. Each one gets its own tab and its own guide.",
    "A new kind of document: Story and ideas, for writing down your story and everything you think of.",
    "Your Docs settings (like the dark page) are now remembered after you close the app.",
    "Make a copy now keeps all the pages of a document.",
  ] },
  { version: "2.7.0", items: [
    "A new, simpler look! All the pages are now in a sidebar on the left, sorted into Convert, Create and Tools.",
    "Fold the sidebar with the button next to the name to make it just icons, and open it again the same way.",
    "The version you're on now shows right under VaultHub.",
    "A tidier Settings window with pages on the left: General, Appearance, Sound and Performance.",
    "The chat now opens next to the sidebar, so your pages stay one click away.",
  ] },
  { version: "2.5.1", items: [
    "Smoother everywhere: scrolling, the chat and long download lists take a lot less work now, and the app rests when it's minimized.",
    "Waveforms in the Library show up much faster, because everyone shares them.",
    "Your save folder isn't forgotten any more when its drive (like a USB stick) is unplugged.",
    "Updates are safer: a download that gets cut off is never installed, and the app closes properly first.",
    "Half-made files from stopped downloads get cleaned up in every folder, not just the main one.",
    "Closing the trim editor stops a clip that's still downloading.",
    "Lots of chat and group fixes, like leaving a group that's gone, and old chat pictures getting cleaned up.",
    "Docs: a picture that's too big to share now says so, and you're asked before leaving with changes that didn't send.",
  ] },
  { version: "2.5.0", items: [
    "Genres in the Library! Pick Music, SFX or Ambience and a list of genres shows up on the left, like Action, Chill or Whooshes.",
    "Put a sound in a genre with the pencil button, or pick the genre when you upload.",
    "Memes and Other are gone: meme sounds are now in SFX under Memes, and the rest is in SFX.",
    "A new, clearer glass look: see-through glass with bright edges, all over the app.",
  ] },
  { version: "2.4.0", items: [
    "A new logo: a white V on black.",
    "The chat is a whole page now, like Discord. Open it with the new chat button at the top.",
    "On the left you'll find the everyone chat, your groups and your private messages.",
    "Make your own groups with the + next to Groups, and only the people you pick can see them. Add more people later, rename the group or leave it from the buttons at the top.",
    "Give a group its own picture: open Group settings and click the picture.",
    "Start a private chat with anyone using the + next to Private messages.",
  ] },
  { version: "2.3.0", items: [
    "The app has a new name: VaultHub! Your settings, login, docs and history all stay.",
    "Drag a page onto another page in Docs to put it under that page. Drag near the top or bottom edge to move it above or below instead.",
    "Links in docs show a hand when you point at them, and one click opens them.",
    "Black text is now easy to read on the dark page: it turns white (coloured text keeps its colour).",
    "The tour has a new Docs part, and it opens once for everybody after this update. Watch it again any time from the question mark at the top.",
  ] },
  { version: "2.2.0", items: [
    "Collab docs are live now: you see the other person typing right away, and there's no Save button to press any more.",
    "Pages in a document: add pages with the + on the left side, and pages under a page with the ··· button.",
    "Comments in Collab docs: select some words and press the yellow bubble (or Ctrl+Alt+M). Everyone can reply, and you can mark a comment as done.",
    "The new moon button at the top switches the page to black (dark page) or back to white. It's just for you, others keep their own look.",
    "Who's online in a document only shows at the top now, not twice.",
  ] },
  { version: "2.1.0", items: [
    "New document now asks what you want to write: a movie script, video script, shot list, storyboard and more.",
    "Every new document starts completely empty. A short guide next to the page explains how to write that kind of document.",
    "Shot lists, storyboards and call sheets can add an empty table with the right columns in one click.",
    "Close the guide with the X, and bring it back with View, Writing guide.",
  ] },
  { version: "2.0.0", items: [
    "New Docs tab: write documents and movie scripts right in the app, with a page that looks like Google Docs.",
    "Local docs stay private on your computer. Collab docs let you invite people with an account, and only the people who joined can see them.",
    "Templates for a movie script, video script, treatment, storyboard and call sheet, plus fonts, page setup (Letter or A4, margins, paper colour) and zoom.",
    "Docs only save when you press Save or Ctrl+S. If you leave with changes, the app asks if you want to save.",
  ] },
  { version: "1.35.0", items: [
    "A fresh Apple-inspired look: a cleaner font, big bold headlines and Apple's own soft greys in dark and light mode.",
    "The Library list is one neat rounded card with thin lines between sounds, like the iPhone Settings app.",
    "On/off options are now iPhone-style switches, and Settings is laid out in tidy grouped rows.",
    "Rounder buttons and softer corners everywhere, plus easier-to-read links in light mode.",
  ] },
  { version: "1.34.0", items: [
    "Liquid glass everywhere: cards, buttons, menus, popups, the chat and the player are all frosted glass now.",
    "The player floats at the bottom of the Library as a glass bar, and the page softly blurs behind popups.",
    "Fixed: the tab bar no longer covers Settings or other popups, and the chat no longer hides the player's buttons.",
    "Fixed: in a small window the Library categories scroll sideways instead of getting cut off, plus a few smaller fixes.",
  ] },
  { version: "1.33.0", items: [
    "New tabs: a floating glass bar at the top (like Artlist) that's much easier to see, and it stays with you when you scroll.",
    "Every tab has its own little icon, and a glass bubble slides smoothly to the one you pick.",
    "In a small window the tabs show just their icons. Point at one to see its name.",
  ] },
  { version: "1.32.0", items: [
    "The Library checks its sounds for you: anything that turns out to be a known song says \"Most likely copyrighted\" right under its name, with the song and artist.",
    "It happens in the background and is shared, so a sound is only ever checked once for everyone.",
    "The Copyright tab is still there for your own files, and the shield button on a sound still checks it right away.",
  ] },
  { version: "1.31.0", items: [
    "New Copyright tab: drop in a song or sound and the app tells you if it's a known (copyrighted) song, with the title and artist. You can also check any Library sound with the shield button.",
    "No more double uploads: the Library won't take a sound with the same name, or the exact same file, as one that's already there.",
    "Dragging a sound into your editor now shows a little card with its waveform instead of a plain file, with smooth lift and drop animations.",
  ] },
  { version: "1.30.0", items: [
    "Lelons Converter is now called Ultimate Recording! Same app, same account, same settings and history, just a new name.",
    "The new shortcut is on your desktop and in the Start menu. The old ones are removed for you.",
    "An even better tour voice: warmer and much more like a real person, with friendlier words.",
  ] },
  { version: "1.29.0", items: [
    "The Library has cleaner categories: pills at the top (like Artlist), and \"Uploaded by\" is now one small button next to Sort. The list gets the whole width.",
    "The player bar now only shows in the Library, so it never covers the other tabs. Leave the Library and the sound pauses; come back and press play to go on.",
    "The tour has a new, much more natural voice. Turn on \"Voice\" in How to use to hear it.",
    "Lots of small fixes: the Find sounds player, jumping in a sound, settings sometimes not saving on Windows, the chat taking a moment when switching, \"typing...\" staying after you closed the chat, and a faster Library search.",
  ] },
  { version: "1.28.0", items: [
    "A player at the bottom, like Artlist: see what's playing, pause and go on where you were, skip to the next sound, jump around in the waveform, star it, download it and set the volume.",
    "Sounds keep playing when you close the chat, a profile or Find sounds. Press Space to pause.",
    "Help, Send feedback and Settings are now icons at the top. Updates moved into Settings.",
    "A cleaner installer: no more long list of files, just a simple progress bar.",
  ] },
  { version: "1.27.0", items: [
    "The chat shows when someone is typing, and little faces show who has seen your message.",
    "Home has a new Activity list: new sounds (play them right there), new people, new videos and channels hitting a big number.",
    "The app opens instantly: it shows what you saw last time straight away, and updates it in the background.",
    "A cleaner look: Settings has its own button at the top, and the Library shows fewer buttons until you point at a sound.",
  ] },
  { version: "1.26.1", items: [
    "Playing a sound in the Library no longer jumps you back to the top. The same fix is in every list in the app.",
    "Find sounds doesn't flicker anymore while you type or play sounds.",
    "Only one sound plays at a time now. Starting a new one stops the other.",
    "Clicking two sounds quickly no longer shows a wrong \"check your internet\" message.",
    "Home, History, the chat and Stats update without everything fading in again, so clicks don't get lost.",
    "Double-clicking Convert or Download only starts it once.",
    "Stats loads faster and keeps updating after you minimize the app.",
  ] },
  { version: "1.26.0", items: [
    "Find sounds: search free sound effects and meme sounds right from the Library. Listen, download, or add them to the Library in one click.",
    "Channel stats: click \"See stats\" on Home for charts of how our channels are growing, a leaderboard and the most watched videos.",
    "Fixed the tour playing scenes on top of each other when you watched it again.",
  ] },
  { version: "1.25.0", items: [
    "A new animated tour that shows how to use the app. Watch it again any time with \"How to use\" at the bottom.",
    "Turn on \"Voice\" in the tour and it reads itself out loud.",
  ] },
  { version: "1.24.0", items: [
    "A volume slider! Click the speaker at the top (or go to Settings). It works for every sound in the app.",
    "Uploaded a sound to the wrong category? Click the pencil on it to change its name or category.",
    "A refresh button at the top (F5 works too) loads the page you're on again.",
    "The app now asks where to save every time you convert or download. Want it to always save in one folder? Pick that in Settings, Where to save.",
  ] },
  { version: "1.23.0", items: [
    "A new Home page! It's the first tab now.",
    "Live subscriber counters for all our YouTube channels, plus the total. The numbers roll up when they change.",
    "The newest uploads from our channels: watch them, or convert them in one click.",
    "See who's online, the newest sounds in the Library and the latest chat messages, right on Home.",
    "Your own stats (files converted, minutes, favorite format) and your recent downloads, ready to drag into your editor.",
    "Paste a link on Home and it starts converting right away.",
  ] },
  { version: "1.22.0", items: [
    "Make the whole app bigger or smaller: Settings, Size. Or hold Ctrl and scroll, or press Ctrl and + or -. Ctrl and 0 goes back to normal.",
    "You can always see who uploaded a sound in the Library now, even in a small window.",
    "A cleaner look: softer corners, less clutter and a roomier layout on big screens.",
    "Smooth animations everywhere: popups glide in, the chat slides open, a line follows the tab you pick and new messages float in.",
    "The window's title bar now matches your theme.",
  ] },
  { version: "1.21.0", items: [
    "Send Library sounds in the chat with the new chat button on a sound, or a trimmed clip with \"Send to chat\" in the trim editor. Others can play them or drag them into their editor.",
    "React to messages with emojis, and @mention people (type @ to pick a name). Mentions light up and ding.",
    "Private messages: click someone's name, then \"Send a message\". Only you two can see it.",
    "Profiles: click a name or picture to see someone's role, when they were last online, and their newest sounds.",
    "Paste a bunch of links at once (or a few playlists) and convert them all in one go.",
    "A soft ding for new messages. You can turn it off in Settings.",
  ] },
  { version: "1.20.0", items: [
    "Live chat! Click \"online\" at the top right to chat with everyone who has an account.",
    "See how many people have the app open right now, and who.",
    "Themes: pick Dark, Black or Light, and your own color, in Settings (at the bottom).",
    "A Hardware acceleration switch in Settings. It's on by default; turn it off if videos come out broken or the app looks glitchy.",
    "The app now remembers your last tab, your Library sort and your Files and Images options after you close it.",
  ] },
  { version: "1.19.0", items: [
    "Send feedback: found a bug or want something added? Click \"Send feedback\" at the bottom (or in the account menu) and write to the owner.",
    "A new Library layout: All sounds, Favorites, the categories and who uploaded them are in a panel on the left.",
    "Sort the Library by favorites, newest, oldest, name, length or uploader.",
    "Bug fixes and a faster, lighter app: it uses less of your PC while it sits open, and cleans up clips and sounds you never dragged anywhere.",
  ] },
  { version: "1.18.0", items: [
    "Drag clips straight out of the trim editor: pick your part, click \"Make a clip to drag\" and drop it into DaVinci Resolve. Move the lines and the clip updates by itself.",
    "Favorites in the Library: click the star on a sound. Your starred sounds show at the top, and the Favorites chip shows only them.",
  ] },
  { version: "1.17.0", items: [
    "This window! After every update it shows what changed. You can open it again with \"What's new\" at the bottom.",
  ] },
  { version: "1.16.0", items: [
    "Drag finished downloads, history items, converted files, pictures and Library sounds straight into DaVinci Resolve, Premiere, Discord or a folder.",
    "Tip: trim, download, then grab it from the Downloads list.",
  ] },
  { version: "1.15.0", items: [
    "Your own Account page: change your picture, username or password, log out, or delete your account.",
    "People and roles moved to the Account page.",
  ] },
  { version: "1.14.1", items: [
    "A round account button at the top right, on every tab, for logging in and managing your account.",
  ] },
  { version: "1.14.0", items: [
    "SFX is now the Library, with real accounts (username and password) instead of a friend code.",
    "Roles: the Owner manages everyone, Admins upload and delete, Viewers listen and download.",
    "Sounds show who uploaded them, and everyone can have a profile picture.",
  ] },
  { version: "1.13.1", items: [
    "A cleaner sound library with a waveform for every sound. Click it to play from that spot.",
  ] },
  { version: "1.13.0", items: [
    "A shared sound library with your friends, with categories like SFX, Music and Memes.",
  ] },
  { version: "1.12.0", items: [
    "Stop button for downloads, a History tab, the window remembers where you left it, and faster trimming.",
  ] },
];

const versionParts = (v) => String(v || "0").split(".").map((n) => parseInt(n, 10) || 0);
function newerThan(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function showWhatsNew(entries, sub) {
  setChildren($("whatsNewList"), entries.map((entry) => {
    const block = document.createElement("section");
    const head = document.createElement("h3");
    head.textContent = "Version " + entry.version;
    const list = document.createElement("ul");
    list.append(...entry.items.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
    block.append(head, list);
    return block;
  }));
  $("whatsNewSub").textContent = sub;
  $("whatsNewAll").hidden = entries.length >= CHANGES.length;
  $("whatsNewModal").hidden = false;
  $("whatsNewList").scrollTop = 0;
}

let whatsNewChecked = false;
function checkWhatsNew(s) {
  if (whatsNewChecked) return;
  if (typeof tourShowing === "function" && tourShowing()) return; // after the tour
  whatsNewChecked = true;
  if (s.seenVersion === s.version) return;
  // The tour opened by itself on a new install: that's enough for now.
  if (!s.seenVersion && typeof tourShownNow !== "undefined" && tourShownNow) return void api("/api/seen-version", {}).catch(() => {});
  // Everything since the last version you saw (or just this one, on a new install).
  const fresh = CHANGES.filter((c) => !newerThan(c.version, s.version) && (s.seenVersion ? newerThan(c.version, s.seenVersion) : c.version === s.version));
  api("/api/seen-version", {}).catch(() => {});
  if (fresh.length) showWhatsNew(fresh, `You're on version ${s.version} now. Here's what changed.`);
}

$("whatsNewOpen").addEventListener("click", () => showWhatsNew(CHANGES.slice(0, 3), ""));
$("whatsNewAll").addEventListener("click", () => showWhatsNew(CHANGES, ""));
$("whatsNewClose").addEventListener("click", () => { $("whatsNewModal").hidden = true; });
$("whatsNewModal").addEventListener("click", (e) => { if (e.target === $("whatsNewModal")) $("whatsNewModal").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("whatsNewModal").hidden = true; });
