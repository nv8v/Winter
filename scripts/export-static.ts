// Exports the Fresh application as a static site for GitHub Pages.
// Requires a previous `deno task build` so that the `_fresh` snapshot exists.

const outputDir = "dist";
const port = 8000;
const origin = `http://127.0.0.1:${port}`;
const basePath = (Deno.env.get("BASE_PATH") ?? "").replace(/\/+$/, "");

async function copyDirectory(
  source: string,
  destination: string,
): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = `${source}/${entry.name}`;
    const to = `${destination}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDirectory(from, to);
    } else if (entry.isFile) {
      await Deno.copyFile(from, to);
    }
  }
}

async function collectPages(): Promise<string[]> {
  const pages = ["/", "/about", "/courses", "/offline"];
  for await (const entry of Deno.readDir("courses")) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      pages.push(`/${entry.name.slice(0, -3)}`);
      continue;
    }
    if (!entry.isDirectory) continue;

    const groupDir = `courses/${entry.name}`;
    try {
      const metadata = JSON.parse(
        await Deno.readTextFile(`${groupDir}/_data.json`),
      ) as { lableSlug?: string };
      if (metadata.lableSlug) {
        pages.push(`/group/${metadata.lableSlug}`);
      }
    } catch {
      // A folder without _data.json has no group page.
    }

    for await (const course of Deno.readDir(groupDir)) {
      if (course.isFile && course.name.endsWith(".md")) {
        pages.push(`/${entry.name}/${course.name.slice(0, -3)}`);
      }
    }
  }
  return [...new Set(pages)];
}

async function waitForServer(process: Deno.ChildProcess): Promise<void> {
  const state: { code: number | null } = { code: null };
  process.status.then((status) => {
    state.code = status.code;
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (state.code !== null) {
      throw new Error(
        `Fresh server exited before becoming ready (code ${state.code}).`,
      );
    }
    try {
      const response = await fetch(`${origin}/courses`);
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // The server may need a few seconds to start.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Fresh server did not become ready within 30 seconds.");
}

async function fetchOk(route: string): Promise<Response> {
  const response = await fetch(new URL(route, origin));
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Failed to fetch ${route}: HTTP ${response.status}`);
  }
  return response;
}

function outputPath(route: string): string {
  if (route === "/") return `${outputDir}/index.html`;
  return `${outputDir}/${route.replace(/^\/+|\/+$/g, "")}/index.html`;
}

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, content);
}

// Only URL-bearing attributes and Fresh's own asset imports are prefixed, so
// that strings inside course code or serialized island props stay untouched.
function prefixHtml(content: string): string {
  if (!basePath) return content;
  return content
    .replace(
      /(\s(?:href|src|action|poster)\s*=\s*)(["'])\/(?!\/)/g,
      `$1$2${basePath}/`,
    )
    .replace(/(["'`])\/_frsh\//g, `$1${basePath}/_frsh/`);
}

function prefixScript(content: string): string {
  if (!basePath) return content;
  return content.replace(/(["'`])\/_frsh\//g, `$1${basePath}/_frsh/`);
}

function prefixManifest(content: string): string {
  if (!basePath) return content;
  return content.replace(
    /("(?:src|start_url|scope)"\s*:\s*")\/(?!\/)/g,
    `$1${basePath}/`,
  );
}

async function rewriteStaticFiles(directory: string): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory) {
      await rewriteStaticFiles(path);
    } else if (entry.name === "manifest.json") {
      await Deno.writeTextFile(
        path,
        prefixManifest(await Deno.readTextFile(path)),
      );
    }
  }
}

try {
  await Deno.stat("_fresh/snapshot.json");
} catch {
  throw new Error("Missing _fresh/snapshot.json. Run `deno task build` first.");
}

await Deno.remove(outputDir, { recursive: true }).catch(() => {});
await Deno.mkdir(outputDir, { recursive: true });
await Deno.writeTextFile(`${outputDir}/.nojekyll`, "");

const server = new Deno.Command(Deno.execPath(), {
  args: ["run", "-A", "main.ts"],
  cwd: Deno.cwd(),
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

try {
  await waitForServer(server);

  // Pages
  for (const route of await collectPages()) {
    const response = await fetchOk(route);
    await writeFile(outputPath(route), prefixHtml(await response.text()));
    console.log(`Rendered ${route}`);
  }

  // GitHub Pages serves 404.html for unknown URLs.
  const notFound = await fetch(`${origin}/not-a-real-route`);
  await writeFile(`${outputDir}/404.html`, prefixHtml(await notFound.text()));

  // Static files, then the compiled stylesheet over the raw Tailwind source.
  await copyDirectory("static", outputDir);
  const css = await fetchOk("/styles.css");
  await Deno.writeTextFile(`${outputDir}/styles.css`, await css.text());
  await rewriteStaticFiles(outputDir);

  // Island bundles served by Fresh under /_frsh/js/<build id>/.
  const snapshot = JSON.parse(
    await Deno.readTextFile("_fresh/snapshot.json"),
  ) as { build_id: string; files: Record<string, string[]> };
  for (const file of Object.keys(snapshot.files)) {
    const route = `/_frsh/js/${snapshot.build_id}/${file}`;
    const response = await fetchOk(route);
    const destination = `${outputDir}${route}`;
    if (file.endsWith(".js")) {
      await writeFile(destination, prefixScript(await response.text()));
    } else {
      await Deno.mkdir(destination.slice(0, destination.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeFile(
        destination,
        new Uint8Array(await response.arrayBuffer()),
      );
    }
  }

  console.log(
    `Static site exported to ${outputDir} (base path: "${basePath}").`,
  );
} finally {
  try {
    server.kill("SIGTERM");
  } catch {
    // The server may already have exited.
  }
  await server.status;
}
