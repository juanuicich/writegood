/** Drive a running debug build of the app from the terminal (SPEC §16.3).
 *
 *  `bun run app` starts a WebDriver server inside the window on 127.0.0.1:4445.
 *  Each call here opens a session, does one thing and closes the session.
 *  Closing a session does not close the window.
 *
 *    bun dev/drive.ts shot [file]        screenshot of the page
 *    bun dev/drive.ts text [selector]    the text of an element (default the editor)
 *    bun dev/drive.ts html [selector]    the outer HTML of an element
 *    bun dev/drive.ts eval '<js>'        run JavaScript in the page, print the result
 *    bun dev/drive.ts click <selector>   click an element
 *    bun dev/drive.ts keys <key>...      send keys, e.g. Escape j j
 *    bun dev/drive.ts type '<text>'      insert text in the editor at the cursor
 *
 *  A dev build uses the real ~/.writegood. click, keys and type change the open
 *  file, and the app saves it. Start the dev build with WRITEGOOD_HOME set to a
 *  scratch directory before driving edits. */
import { Key, remote } from "webdriverio";

const EDITOR = ".ProseMirror";
const port = Number(process.env.TAURI_WEBDRIVER_PORT ?? 4445);
const [command, ...args] = process.argv.slice(2);

/** A key by its WebDriver name (Escape, Enter, ArrowDown, Command, ...), or
 *  the text as typed. */
const key = (name: string): string => (Key as Record<string, string>)[name] ?? name;

function usage(): never {
  console.error(
    "usage: bun dev/drive.ts shot [file] | text [selector] | html [selector] |\n" +
      "       eval '<js>' | click <selector> | keys <key>... | type '<text>'",
  );
  process.exit(2);
}

async function connect() {
  try {
    const status = await fetch(`http://127.0.0.1:${port}/status`);
    if (!status.ok) throw new Error(`status ${status.status}`);
  } catch {
    console.error(`no WebDriver server on 127.0.0.1:${port}. Is a debug build running (bun run app)?`);
    process.exit(1);
  }
  return remote({ hostname: "127.0.0.1", port, capabilities: {}, logLevel: "error" });
}

/** How many arguments each command needs, checked before connecting so a
 *  mistake never leaves a session open. */
const NEEDS: Record<string, number> = { shot: 0, text: 0, html: 0, eval: 1, click: 1, keys: 1, type: 1 };
if (!command || !(command in NEEDS) || args.length < NEEDS[command]!) usage();

const browser = await connect();
try {
  switch (command) {
    case "shot": {
      const file = args[0] ?? "/tmp/writegood.png";
      await browser.saveScreenshot(file);
      console.log(file);
      break;
    }
    case "text":
      // innerText keeps the line breaks between blocks; getText does not.
      console.log(
        await browser.execute(
          (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.innerText ?? null,
          args[0] ?? EDITOR,
        ),
      );
      break;
    case "html":
      console.log(await browser.$(args[0] ?? EDITOR).getHTML());
      break;
    case "eval": {
      // The body runs as a function, so a bare expression needs a return.
      const body = /\breturn\b/.test(args[0]!) ? args[0]! : `return (${args[0]})`;
      const result = await browser.execute(body);
      console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
      break;
    }
    case "click":
      await browser.$(args[0]!).click();
      break;
    case "keys":
      await browser.keys(args.map(key));
      break;
    case "type":
      // keys() inserts nothing in a contenteditable; addValue does (SPEC §16.1).
      await browser.$(EDITOR).addValue(args[0]!);
      break;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await browser.deleteSession();
}
