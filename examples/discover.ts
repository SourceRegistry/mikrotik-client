import { DatacenterManager } from "../src/experimental/index";

async function main() {
  const discovered = await DatacenterManager.discover({
    subnets: [(process.env.MIKROTIK_DISCOVER_CIDR ?? "192.168.88.0/24") as string],
    credentials: [
      {
        username: process.env.MIKROTIK_USERNAME ?? "admin",
        password: process.env.MIKROTIK_PASSWORD ?? "",
      },
    ],
    timeoutMs: Number(process.env.MIKROTIK_DISCOVER_TIMEOUT_MS ?? 1200),
    concurrency: Number(process.env.MIKROTIK_DISCOVER_CONCURRENCY ?? 64),
    defaultSite: process.env.MIKROTIK_DEFAULT_SITE,
    defaultRole: process.env.MIKROTIK_DEFAULT_ROLE,
    tags: process.env.MIKROTIK_DEFAULT_TAGS?.split(",").filter(Boolean),
  });

  console.log(discovered);
}

void main();
