# BeerBot
[![NullDev/DiscordJS-Template](https://img.shields.io/badge/Template%3A-NullDev%2FDiscordJS--Template-green?style=flat-square&logo=github)](https://github.com/NullDev/DiscordJS-Template) [![License](https://img.shields.io/github/license/NullDev/BeerBot?label=License&logo=Creative%20Commons)](https://github.com/NullDev/BeerBot/blob/master/LICENSE) [![GitHub closed issues](https://img.shields.io/github/issues-closed-raw/NullDev/BeerBot?logo=Cachet)](https://github.com/NullDev/BeerBot/issues?q=is%3Aissue+is%3Aclosed)

<p align="center"><img height="250" width="auto" src="/assets/icon.png" /></p>
<p align="center"><b>Discord Bot to manage the members of an Austrian Discord Server</b></p>
<hr>

## :question: What does it do?

This is just a verification bot. <br>
I hob des an einem tog zomklatscht oiso schen is echt ned.

<hr>

## :diamond_shape_with_a_dot_inside: Feature requests & Issues

Feature request or discovered a bug? Please [open an Issue](https://github.com/NullDev/BeerBot/issues/new/choose) here on GitHub.

<hr>

## :wrench: Setup

0. Open up your favourite terminal (and navigate somewhere you want to download the repository to). <br><br>
1. Make sure you have Bun installed (>= v1.2.17). Test by entering <br>
$ `bun -v` <br>
If this returns a version number, Bun is installed. **If not**, get Bun <a href="https://bun.sh/">here</a>. <br><br>
2. Clone the repository and navigate to it. If you have Git installed, type <br>
$ `git clone https://github.com/NullDev/BeerBot.git && cd BeerBot` <br>
If not, download it <a href="https://github.com/NullDev/BeerBot/archive/master.zip">here</a> and extract the ZIP file.<br>
Then navigate to the folder.<br><br>
3. Install all dependencies by typing <br>
$ `bun install`<br><br>
4. Copy [config/config.template.js](https://github.com/NullDev/BeerBot/blob/master/config/config.template.js) and paste it as `config/config.custom.js` OR use `bun run generate-config`. <br><br>
5. Configure it in your favourite editor by editing `config/config.custom.js`. <br><br>
6. Start it in development mode by running <br>
$ `bun start` <br>
or start in production mode <br>
$ `bun run start:prod` <br><br>

<hr>

## :nut_and_bolt: Configuration

Once the config has been copied like described in [Step 4](#wrench-setup), it can be changed to your needs:

| Config Key | Description | Data Type | Default value |
| ---------- | --------- | ------------------ | ------------ |
| discord: <br> `bot_token` | Auth Token of the Discord bot. Can be created [here](https://discordapp.com/developers/). | String | N/A |
| discord: <br> `bot_owner_ids` | OPTIONAL: Discord IDs of Bot owners | String-Array | [] |
| roles: <br> `verified` | ID of the verified role | string | N/A |
| roles: <br> `unverified` | ID of the verified role | string | N/A |
| roles: <br> `birthday` | ID of the bday role | string | N/A |
| roles: <br> `ages` | Object of all ages roles | object | {} |
| roles: <br> `gender` | Object of all gender roles | object | {} |
| roles: <br> `country_verified` | Object of all verified country roles | object | {} |
| roles: <br> `country_unverified` | Object of all temp country roles | object | {} |
| channels: <br> `general` | ID of the general chat to announce bdays | string | N/A |
| openai: <br> `token` | OpenAI Token for Welcome Msg | string | N/A |
| openai: <br> `model` | Which model to use for Welcome Msg | string | "gpt-4" |

<hr>

<img height="auto" width="100%" src="/assets/banner-crop.jpg" />
