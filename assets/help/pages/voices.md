# Voices

Voices sets up reading replies aloud. Each character and your [Persona](help:glossary) get a voice cloned from a short clip, and the voice server on your desktop (Chatterbox, reached over Tailscale) reads the quoted dialogue of a reply in each speaker's voice. The connection works with no chat open; the voice cards need a chat.

Read aloud is in each reply's message menu, beside What was sent, once an address is saved. It reads the words in double quotes; narration and thoughts are not read.

## What it does

### Desktop voice

- **Address** is the desktop's Tailscale address and the voice server's port, for example http://100.x.y.z:8125. An address that cannot work shows the reason under the box.
- **Key** is the key from the .key file beside the server, in a masked field.
- **Check each line by transcription** starts on. The desktop transcribes each line and reads it again with a new seed when the words differ. Turning it off keeps each line as first rendered.
- **More feeling on exclaimed and shouted lines** starts off. Turned on, a line with an exclamation, a word in capitals, or a quote the story says was shouted, yelled or snapped gets a little more expressiveness for that line alone.
- **Test the connection** checks the desktop and reports how it answered, its default settings and whether the line check is available.

### Voices in this chat

One card per character in the chat and one for your persona. A clip should be 10 to 15 seconds of clean speech in the voice the character holds. A character with no voice is read in the main character's voice, or the built-in voice when that one has none.

- **Record** uses the phone's microphone. Tap again to stop; it stops by itself at 16 seconds. The button then reads **Record again**.
- **Upload a clip** takes an audio file.
- **Play test line** plays a test sentence in the saved voice.
- **Remove** deletes the voice.

Every clip is checked for length, level, clipping, noise and silence, and trimmed. A clip that fails is refused with the reasons; one that passes is sent to the desktop as that character's voice, and the test line plays so your ear can judge it.

### Delivery

A fold on each card that has a voice, titled with its current delivery (King County, the starting settings, when unchanged). Every change saves at once.

- **Expressiveness** is how much feeling goes into a line, from 0.3 to 1. It starts at 0.65.
- **Steadiness** makes takes keep closer to the clip, or wander more, from -2 to +2. It starts at 0.
- **Pace** moves the voice's pacing and the pauses between lines, from -2 to +2. It starts at 0.
- **Hear it** beside each slider plays that slider's test line as the sliders stand.
- **A: King County** plays the card's test line with the starting settings.
- **B: these settings** plays it with yours, on the same seed, so only the sliders differ.
- **Reset to King County** puts the sliders back to the start.
- **Presets** lists saved deliveries; **Use preset** applies one and **Delete preset** removes it.
- **Preset name** and **Save as preset** save the sliders under a name any card can use.

## Model calls and cost

Nothing on this page makes a model call or counts toward the monthly ceiling. Audio comes from the voice server on your desktop over Tailscale; finding each quote's speaker, splitting lines and checking clips [run in code](help:model-calls). Lines already read are kept per reply and swipe, so playing them again costs nothing.

## Why it works this way

- Voices stay on your own machines; the server is reached over your Tailscale network alone.
- Your ear decides, so every saved voice and every slider has a test line.
- There is no speed control, because it distorted the voice; Pace changes pacing and pauses.
- One clip per character keeps each voice the same across replies.
