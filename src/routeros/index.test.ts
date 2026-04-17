import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { encodeSentence, SentenceDecoder } from "../shared";
import { RouterOSClient, RouterOSTrapError } from "./index";

function parseSentenceWord(word: string): { key: string; value: string } | undefined {
  if (!word.startsWith("=") && !word.startsWith(".")) return undefined;
  const index = word.indexOf("=", 1);
  if (index === -1) {
    return { key: word.slice(1), value: "" };
  }
  return {
    key: word.slice(1, index),
    value: word.slice(index + 1),
  };
}

function getSentenceValue(words: string[], prefix: "=" | ".", key: string): string | undefined {
  const match = words.find((word) => word.startsWith(`${prefix}${key}=`));
  return match ? match.slice(key.length + 2) : undefined;
}

function createMockServer() {
  const server = net.createServer((socket) => {
    const decoder = new SentenceDecoder();
    let listenTag: string | undefined;

    socket.on("data", (chunk) => {
      for (const sentence of decoder.push(chunk)) {
        const command = sentence[0];
        const tag = getSentenceValue(sentence, ".", "tag");

        if (command === "/login") {
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/system/resource/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=uptime=1d2h",
              "=cpu-load=12",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/system/identity/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=name=mikrotik-lab",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/system/identity/set") {
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/interface/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*1",
              "=name=ether1",
              "=running=yes",
              "=disabled=no",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/interface/bonding/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*8",
              "=name=bond-server01",
              "=mode=802.3ad",
              "=slaves=ether1,ether2",
              "=lacp-rate=1sec",
              "=mlag-id=10",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/interface/set" && getSentenceValue(sentence, "=", ".id") === "missing-interface") {
          socket.write(
            encodeSentence([
              "!trap",
              "=category=1",
              "=message=input does not match any value of interface",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/interface/set") {
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/ip/address/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*2",
              "=address=192.168.88.1/24",
              "=interface=bridge",
              "=disabled=no",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/interface/bridge/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*4",
              "=name=bridge",
              "=vlan-filtering=no",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/interface/bridge/port/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*5",
              "=bridge=bridge",
              "=interface=ether2",
              "=pvid=1",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/interface/bridge/vlan/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*9",
              "=bridge=bridge",
              "=vlan-ids=10",
              "=tagged=bridge,bond-server01",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/ppp/secret/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*6",
              "=name=user1",
              "=service=pppoe",
              "=profile=default",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/routing/rule/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*7",
              "=action=lookup",
              "=table=main",
              "=src-address=10.10.10.0/24",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/interface/wireguard/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*10",
              "=name=wg-site2",
              "=listen-port=51820",
              "=running=yes",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/interface/wireguard/peers/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*11",
              "=interface=wg-site2",
              "=allowed-address=10.255.255.2/32,10.20.0.0/16",
              "=endpoint-address=site2.example.net",
              "=endpoint-port=51820",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/routing/bgp/template/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*12",
              "=name=dc-ebgp",
              "=as=65001",
              "=router-id=10.255.255.1",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/routing/bgp/connection/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*13",
              "=name=site2-ebgp",
              "=remote.address=10.255.255.2",
              "=remote.as=65002",
              "=local.address=10.255.255.1",
              "=multihop=yes",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (
          command === "/ip/address/add" ||
          command === "/ip/address/set" ||
          command === "/ip/address/remove" ||
          command === "/interface/bonding/add" ||
          command === "/interface/bonding/set" ||
          command === "/interface/bonding/remove" ||
          command === "/interface/bridge/add" ||
          command === "/interface/bridge/set" ||
          command === "/interface/bridge/remove" ||
          command === "/interface/bridge/port/add" ||
          command === "/interface/bridge/port/set" ||
          command === "/interface/bridge/port/remove" ||
          command === "/interface/bridge/vlan/add" ||
          command === "/interface/bridge/vlan/remove" ||
          command === "/ip/firewall/filter/add" ||
          command === "/ip/firewall/filter/remove" ||
          command === "/interface/wireguard/add" ||
          command === "/interface/wireguard/set" ||
          command === "/interface/wireguard/remove" ||
          command === "/interface/wireguard/peers/add" ||
          command === "/interface/wireguard/peers/set" ||
          command === "/interface/wireguard/peers/remove" ||
          command === "/ppp/secret/add" ||
          command === "/ppp/secret/set" ||
          command === "/ppp/secret/remove" ||
          command === "/routing/bgp/template/add" ||
          command === "/routing/bgp/template/set" ||
          command === "/routing/bgp/template/remove" ||
          command === "/routing/bgp/connection/add" ||
          command === "/routing/bgp/connection/set" ||
          command === "/routing/bgp/connection/remove" ||
          command === "/routing/rule/add" ||
          command === "/routing/rule/remove"
        ) {
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/ip/firewall/filter/print") {
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*3",
              "=chain=input",
              "=action=accept",
              "=comment=allow management",
              `.tag=${tag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          continue;
        }

        if (command === "/interface/listen") {
          listenTag = tag;
          socket.write(
            encodeSentence([
              "!re",
              "=.id=*1",
              "=name=ether1",
              "=running=yes",
              `.tag=${tag}`,
            ])
          );
          continue;
        }

        if (command === "/cancel" && getSentenceValue(sentence, "=", "tag") === listenTag) {
          socket.write(
            encodeSentence([
              "!trap",
              "=category=2",
              "=message=interrupted",
              `.tag=${listenTag}`,
            ])
          );
          socket.write(encodeSentence(["!done", `.tag=${tag}`]));
          socket.write(encodeSentence(["!done", `.tag=${listenTag}`]));
        }
      }
    });
  });

  return server;
}

describe("RouterOSClient", () => {
  const servers = new Set<net.Server>();

  afterEach(async () => {
    await Promise.all(
      [...servers].map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) reject(error);
              else resolve();
            });
          })
      )
    );
    servers.clear();
  });

  it("logs in and executes a print command through the dynamic api", async () => {
    const server = createMockServer();
    servers.add(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to start mock RouterOS server.");
    }

    const client = new RouterOSClient({
      host: "127.0.0.1",
      port: address.port,
      username: "admin",
      password: "",
    });

    const records = await client.api.system.resource.print({
      attributes: {
        ".proplist": ["uptime", "cpu-load"],
      },
    });

    expect(records).toEqual([{ uptime: "1d2h", "cpu-load": "12" }]);
    await client.close();
  });

  it("turns trap replies into RouterOSTrapError", async () => {
    const server = createMockServer();
    servers.add(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to start mock RouterOS server.");
    }

    const client = new RouterOSClient({
      host: "127.0.0.1",
      port: address.port,
      username: "admin",
      password: "",
    });

    await expect(
      client.api.interface.set({
        attributes: {
          ".id": "missing-interface",
          disabled: true,
        },
      })
    ).rejects.toBeInstanceOf(RouterOSTrapError);

    await client.close();
  });

  it("streams listen replies and cancels the listener", async () => {
    const server = createMockServer();
    servers.add(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to start mock RouterOS server.");
    }

    const client = new RouterOSClient({
      host: "127.0.0.1",
      port: address.port,
      username: "admin",
      password: "",
    });

    const stream = await client.api.interface.listen();
    const firstReply = await stream.nextReply(500);
    expect(firstReply?.attributes.name).toBe("ether1");

    await stream.cancel();
    await expect(stream.nextReply(500)).rejects.toBeInstanceOf(RouterOSTrapError);
    await client.close();
  });

  it("exposes typed helper methods for common menus", async () => {
    const server = createMockServer();
    servers.add(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to start mock RouterOS server.");
    }

    const client = new RouterOSClient({
      host: "127.0.0.1",
      port: address.port,
      username: "admin",
      password: "",
    });

    const [
      resource,
      identity,
      interfaces,
      addresses,
      filters,
      bonds,
      bridges,
      bridgePorts,
      bridgeVlans,
      pppSecrets,
      wgInterfaces,
      wgPeers,
      bgpTemplates,
      bgpConnections,
      routingRules,
    ] = await Promise.all([
      client.system.resource.get({
        proplist: ["uptime", "cpu-load"],
      }),
      client.system.identity.get(),
      client.interface.list(),
      client.ip.address.list(),
      client.ip.firewall.filter.list(),
      client.interface.bonding.list(),
      client.bridge.list(),
      client.bridge.port.list(),
      client.bridge.vlan.list(),
      client.ppp.secret.list(),
      client.wireguard.interface.list(),
      client.wireguard.peer.list(),
      client.routing.bgp.template.list(),
      client.routing.bgp.connection.list(),
      client.routing.rule.list(),
    ]);

    expect(resource?.uptime).toBe("1d2h");
    expect(identity?.name).toBe("mikrotik-lab");
    expect(interfaces[0]?.name).toBe("ether1");
    expect(addresses[0]?.address).toBe("192.168.88.1/24");
    expect(filters[0]?.chain).toBe("input");
    expect(bonds[0]?.mode).toBe("802.3ad");
    expect(bridges[0]?.name).toBe("bridge");
    expect(bridgePorts[0]?.interface).toBe("ether2");
    expect(bridgeVlans[0]?.["vlan-ids"]).toBe("10");
    expect(pppSecrets[0]?.name).toBe("user1");
    expect(wgInterfaces[0]?.name).toBe("wg-site2");
    expect(wgPeers[0]?.interface).toBe("wg-site2");
    expect(bgpTemplates[0]?.name).toBe("dc-ebgp");
    expect(bgpConnections[0]?.name).toBe("site2-ebgp");
    expect(routingRules[0]?.table).toBe("main");

    await client.system.identity.set("core-router");
    await client.interface.disable("*1");
    await client.interface.bonding.add({
      name: "bond-server01",
      mode: "802.3ad",
      slaves: ["ether1", "ether2"],
      "lacp-rate": "1sec",
      "mlag-id": 10,
    });
    await client.bridge.add({
      name: "bridge-vlan",
      "vlan-filtering": true,
    });
    await client.bridge.set("*4", {
      mlag: true,
      "mlag-id": 10,
    });
    await client.bridge.port.add({
      bridge: "bridge-vlan",
      interface: "ether3",
      pvid: 20,
    });
    await client.bridge.port.set("*5", {
      pvid: 20,
      "frame-types": "admit-only-vlan-tagged",
    });
    await client.bridge.vlan.add({
      bridge: "bridge-vlan",
      "vlan-ids": [10, 20],
      tagged: ["bridge-vlan", "bond-server01"],
    });
    await client.ip.address.add({
      address: "192.168.99.1/24",
      interface: "bridge",
    });
    await client.ip.firewall.filter.add({
      chain: "input",
      action: "accept",
      comment: "allow api",
    });
    await client.wireguard.interface.add({
      name: "wg-site2",
      "listen-port": 51820,
    });
    await client.wireguard.peer.add({
      interface: "wg-site2",
      "public-key": "REMOTE_PUBLIC_KEY_HERE",
      "allowed-address": ["10.255.255.2/32", "10.20.0.0/16"],
      "endpoint-address": "site2.example.net",
      "endpoint-port": 51820,
    });
    await client.ppp.secret.add({
      name: "pppoe-user",
      password: "secret",
      service: "pppoe",
    });
    await client.routing.bgp.template.add({
      name: "dc-ebgp",
      as: 65001,
      "router-id": "10.255.255.1",
    });
    await client.routing.bgp.connection.add({
      name: "site2-ebgp",
      "remote.address": "10.255.255.2",
      "remote.as": 65002,
      "local.address": "10.255.255.1",
      multihop: true,
      templates: "dc-ebgp",
    });
    await client.routing.rule.add({
      action: "lookup",
      table: "main",
      "src-address": "10.10.10.0/24",
    });

    await client.close();
  });

  it("exposes helper namespaces directly on client", async () => {
    const server = createMockServer();
    servers.add(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to start mock RouterOS server.");
    }

    const client = new RouterOSClient({
      host: "127.0.0.1",
      port: address.port,
      username: "admin",
      password: "",
    });

    const [identity, bonds, bridgeVlans, bgpConnections] = await Promise.all([
      client.system.identity.get(),
      client.interface.bonding.list(),
      client.bridge.vlan.list(),
      client.routing.bgp.connection.list(),
    ]);

    expect(identity?.name).toBe("mikrotik-lab");
    expect(bonds[0]?.name).toBe("bond-server01");
    expect(bridgeVlans[0]?.["vlan-ids"]).toBe("10");
    expect(bgpConnections[0]?.name).toBe("site2-ebgp");

    await client.close();
  });
});
