# Lobby Simulator
A bot that facilitates creating community games for Age of Empires 2

Picks random winners from people entering the drawing in a Twitch chat and then invites them to a Steam group chat.

When entering a drawing for the first time (with the `!play` command), you need to add a link to your Steam profile so the bot knows
who to allow into the Steam chat. The bot then saves your Steam profile so you will afterwards be able to enter the drawing
using just `!play` without any arguments.

## Commands
Command                             | Required Level | Description
-----------------------------------:|:--------------:|:-----------
**!play** *link to steam profile*   | User           | Enter the drawing
**!quit**                           | User           | Leave the drawing (remove all tickets)
**!winners**                        | User           | Show all winners of the last drawing
**!draw open**                      | Moderator      | Open a new drawing
**!draw close** *number of winners* | Moderator      | Closes a drawing and picks winners
**!draw reroll** *previous winner*  | Moderator      | Reroll and replace *previous winner*

## Setup
Clone the repository, then `npm install .` to install the dependencies. If you want to use sqlite3 for your database, you'll
also need to install sqlite3 with `npm install sqlite3 --save`. Afterwards, configure the bot in a `config.json` that you will
need to create. See `config.json.sample` for an example.
