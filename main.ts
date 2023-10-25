// deno-lint-ignore-file no-explicit-any
import "https://deno.land/std@0.204.0/dotenv/load.ts";
import {
  bgBlue,
  bgYellow,
  bold,
  red,
} from "https://deno.land/std@0.204.0/fmt/colors.ts";
import { APIGuild } from "https://deno.land/x/discord_api_types@0.31.1/v9.ts";
import { APIDMChannel } from "https://deno.land/x/discord_api_types@0.37.60/payloads/v9/mod.ts";
import { APIUser } from "https://deno.land/x/discord_api_types@0.37.60/payloads/v9/user.ts";

enum TargetType {
  Guild = "Guild",
  DM = "DM",
}
interface Target {
  id: string;
  name: string;
  type: TargetType;
}

const headers = {
  "Authorization": Deno.env.get("DISCORD_TOKEN")!,
};

let userId = null;

function validateConfigs() {
  if (!Deno.env.has("DISCORD_TOKEN")) {
    throw new Error("Missing DISCORD_TOKEN");
  }
}

async function checkAccount() {
  try {
    const accountResponse = await fetch(
      "https://discord.com/api/v9/users/@me",
      {
        headers,
      },
    );
    const account: APIUser = await accountResponse.json();
    console.log(bgBlue("Account"), "Logged in as", bold(account.username));
    userId = account.id;
    return account;
  } catch (e) {
    console.log(red("Account"), "Failed to log in");
    console.error(e);
    throw e;
  }
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getGuildTargets() {
  const guildsResponse = await fetch(
    "https://discord.com/api/v9/users/@me/guilds",
    {
      headers,
    },
  );
  const guilds: APIGuild[] = await guildsResponse.json();
  return guilds.map((guild) => ({
    id: guild.id,
    name: guild.name,
    type: TargetType.Guild,
  }));
}

async function getDMTargets() {
  const dmResponse = await fetch(
    "https://discord.com/api/v9/users/@me/channels",
    {
      headers,
    },
  );
  const dmChannels: APIDMChannel[] = await dmResponse.json();
  return dmChannels.map((dm) => ({
    id: dm.id,
    name: dm.recipients?.map((r) => r.username).join(", ") ||
      "Direct Message Channel",
    type: TargetType.DM,
  }));
}

async function main() {
  let targets: Target[] = [...await getGuildTargets(), ...await getDMTargets()];
  if (Deno.env.has("EXCLUDE_TARGETS")) {
    const excludeTargets = Deno.env.get("EXCLUDE_TARGETS")!.split(",");
    targets = targets.filter((t) => !excludeTargets.includes(t.id));
  }
  if (Deno.env.has("PRIORITIZED_TARGETS")) {
    const prioritizedTargets = Deno.env.get("PRIORITIZED_TARGETS")!.split(",");
    targets = targets.sort((a, _b) =>
      prioritizedTargets.includes(a.id) ? -1 : 1
    );
  }
  console.log(
    bgBlue("Total"),
    "Targets:",
    targets.length,
    "( Guilds:",
    targets.filter((t) => t.type === TargetType.Guild).length,
    "| DMs:",
    targets.filter((t) => t.type === TargetType.DM).length,
    ")",
  );
  for (const target of targets) {
    console.log(
      bgBlue(target.type),
      bold(target.name),
      "ID:",
      bold(target.id),
    );
    const { messages, totalResults } = await fetchMessages(target);
    console.log(bgBlue("Total"), "Messages:", totalResults);
    await deleteMessages(messages, target);
    await wait(2000);
  }
}

async function fetchMessages(target: Target) {
  let offset = 0;

  let totalResults = 0;

  let messages: Array<any> = [];
  while (true) {
    const endpoint = `https://discord.com/api/v9/${target.type === TargetType.Guild ? "guilds" : "channels"
      }/${target.id}/messages/search?author_id=${userId!}&include_nsfw=true&offset=${offset}`;
    try {
      const response: Response = await fetch(
        endpoint,
        {
          headers: headers,
        },
      );
      if (response.status === 200) {
        const data: any = await response.json();
        totalResults = data.total_results;
        messages = messages.concat(data.messages);
        console.log(
          bgBlue("Gathering"),
          bgYellow(target.name),
          "Messages:",
          `${messages.length} ${totalResults}`,
          "Offset:",
          offset,
        );
        if (data.total_results == 0) {
          break;
        } else if (data.messages.length === 0) {
          break;
        } else if (offset >= totalResults) {
          break;
        } else if (messages.length > 100) {
          break;
        }
        offset += data.messages.length;
      } else if (
        response.status === 202 || //indexing
        response.status === 429 //rate limit
      ) {
        const data: any = await response.json();
        const delay: number = data.retry_after * 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        break;
      }
    } catch {
      console.log("Failed to get the messages. Retrying...");
    }
  }
  return { totalResults, messages };
}

async function deleteMessages(messages: any, target: Target) {
  for (const messageAr of messages) {
    const message:any  = messageAr[0]
    await fetch(
      `https://discord.com/api/v9/channels/${message.channel_id}/messages/${message.id}`,
      {
        method: "DELETE",
        headers: headers,
      },
    );
    await wait(2000);
    console.log(
      bgBlue("Deleting"),
      bgYellow(target.name),
      message.content
    )
  }
}

if (import.meta.main) {
  validateConfigs();
  checkAccount();
  main();
}
