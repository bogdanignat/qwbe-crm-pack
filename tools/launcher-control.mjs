// A repository-local control socket, not a PID/port kill: cannot target an unrelated listener.
import { chmodSync, mkdirSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { dirname, join } from "node:path"

export const controlPath = (pack) => join(pack, ".local", "crm-launcher.sock")

export async function openControl(pack, stop) {
  const path = controlPath(pack)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const sockets = new Set()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on("error", () => {})
    socket.once("close", () => sockets.delete(socket))
    socket.setTimeout(2000, () => socket.destroy())
    let request = ""
    socket.on("data", (data) => {
      request += data.toString()
      if (request.length > 16) { socket.destroy(); return }
      if (!request.endsWith("\n")) return
      if (request !== "stop\n") { socket.destroy(); return }
      socket.setTimeout(0)
      socket.removeAllListeners("data")
      stop()
    })
  })
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error("Controlul launcher-ului nu poate porni: există deja o instanță sau un socket rămas după o oprire forțată. Nu șterg și nu opresc procese automat.")))
    server.listen(path, resolve)
  })
  chmodSync(path, 0o600)
  return async () => {
    // Acknowledge only AFTER the supervisor has stopped its children.
    for (const socket of sockets) {
      socket.setTimeout(1000, () => socket.destroy())
      socket.end("stopped\n")
    }
    await new Promise((resolve) => server.close(resolve))
  }
}

export async function requestStop(pack) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(controlPath(pack))
    let response = ""
    socket.setTimeout(12000, () => { socket.destroy(); reject(new Error("Oprirea nu a fost confirmată în 12 secunde. Nu opresc alte procese.")) })
    socket.once("error", (error) => {
      if (error.code === "ENOENT") resolve(false)
      else reject(new Error("Nu pot contacta launcher-ul (posibil socket rămas după oprire forțată). Nu opresc procese după port sau PID."))
    })
    socket.once("connect", () => socket.write("stop\n"))
    socket.on("data", (data) => {
      response += data.toString()
      if (response.length > 32) { socket.destroy(); reject(new Error("Răspuns de control invalid.")) }
    })
    socket.once("end", () => {
      if (response === "stopped\n") resolve(true)
      else reject(new Error("Launcher-ul nu a confirmat oprirea."))
    })
    socket.once("close", () => reject(new Error("Conexiunea s-a închis fără confirmarea opririi.")))
  })
}
