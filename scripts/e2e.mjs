// Drives the real thing in a browser.
//   node scripts/e2e.mjs <dashboard url> [<phone web url> <live dashboard url>]
// The second part needs the tracking server running, the mobile app in web mode, and a dashboard
// started with NEXT_PUBLIC_TRACKING_URL. Uses the installed Chrome: set CHROME_PATH if it's elsewhere.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const [base = "http://localhost:3700", phoneUrl, liveUrl] = process.argv.slice(2);
const OUT = process.env.E2E_OUT ?? ".e2e-shots";
mkdirSync(OUT, { recursive: true });
const executablePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath, headless: true, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });

const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(ok ? "PASS" : "FAIL", name, extra);
};
const errors = [];
const watch = (page) => {
  page.on("console", (m) => { if (m.type() === "error" && !/status of 503/.test(m.text())) errors.push(m.text().slice(0, 240)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 300)));
};

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await ctx.newPage();
watch(page);
const text = () => page.evaluate(() => document.body.innerText);
const wait = (ms = 400) => page.waitForTimeout(ms);
const scrub = async (minutes) => {
  await page.getByLabel("Time of day").evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, minutes);
  await wait();
};

await page.goto(base, { waitUntil: "load", timeout: 240000 });
const pause = page.getByRole("button", { name: "Pause the day" });
await pause.waitFor({ timeout: 60000 });
const clock = () => page.getByLabel("Time of day").inputValue();
const c1 = Number(await clock());
await wait(2500);
const c2 = Number(await clock());
check("the day plays by itself", c2 > c1, `${c1} -> ${c2}`);
await pause.click();
await wait(300);
const paused = await clock();
await wait(800);
check("pause stops the clock", (await clock()) === paused);
await wait(3000);
check("the map draws", await page.locator(".maplibregl-canvas").isVisible());
check("technicians are on the map", (await page.locator(".tech-marker").count()) === 8, `${await page.locator(".tech-marker").count()} markers`);
await page.screenshot({ path: `${OUT}/board.png` });

// Scrubbing and the story.
await scrub(600);
let body = await text();
check("before the call, nothing needs a technician", !body.includes("New call"));
await scrub(702);
body = await text();
check("the urgent call appears when it comes in", body.includes("No heat, baby at home"));
await page.getByRole("button", { name: /Find the best technician/ }).click();
await wait();
body = await text();
const lucas = body.indexOf("Lucas, best fit");
const sam = body.indexOf("Makes other jobs 46 min later");
check("the ranking puts Lucas first, and shows what Sam would cost", lucas > 0 && sam > lucas);
await page.screenshot({ path: `${OUT}/ranking.png` });
await page.getByRole("button", { name: "Show 4 ruled out" }).click();
check("it says who was ruled out and why", (await text()).includes("Priya: Doesn't do heating"));
await page.getByRole("button", { name: "Assign to Lucas" }).click();
await wait(800);
body = await text();
check("assigning gives Lucas the job", body.includes("Lucas") && !body.includes("New call"));
await scrub(760);
body = await text();
check("the job is on Lucas's line", body.includes("Cabbagetown") && /Lucas/.test(body));

// Risk.
await page.getByRole("button", { name: "Back to all" }).click();
await scrub(725);
body = await text();
check("Sam's overrun shows Leaside at risk", /At risk[\s\S]*Leaside/.test(body), body.match(/Leaside[^\n]*\n[^\n]*/)?.[0]);
await page.screenshot({ path: `${OUT}/risk.png` });
await scrub(795);
body = await text();
check("a lost signal is stated, not hidden", body.includes("No signal") && body.includes("Amara: last seen"));

// A technician and a station.
await page.getByRole("button", { name: /^Sam's day/ }).click();
await wait();
body = await text();
check("a technician's day opens", body.includes("Jobs done") && body.includes("km driven") && body.includes("Don Mills"));
await page.screenshot({ path: `${OUT}/technician.png` });
await page.getByRole("button", { name: /Don Mills/ }).first().click();
await wait();
check("a job opens from there", (await text()).includes("Water heater flush"));

// Keyboard.
await page.getByLabel("Time of day").focus();
const k1 = Number(await clock());
await page.keyboard.press("ArrowRight");
await wait(150);
check("the time scrubber works with a keyboard", Number(await clock()) === k1 + 1);

// Theme.
await page.getByRole("button", { name: "Use the dark theme" }).click();
await wait(2500);
check("dark theme applies", await page.evaluate(() => document.documentElement.classList.contains("dark")));
await page.screenshot({ path: `${OUT}/dark.png` });
await page.getByRole("button", { name: "Use the light theme" }).click();
await wait(1500);

// Copilot, in whichever mode this server has.
await page.getByRole("tab", { name: "Copilot" }).click();
await scrub(702);
await page.getByLabel("Ask the copilot").fill("Who should take the Cabbagetown no-heat call?");
await page.getByRole("button", { name: "Ask", exact: true }).click();
await page.getByText(/^✓/).first().waitFor({ timeout: 45000 });
await wait(2500);
body = await page.locator("aside").innerText();
console.log("  copilot:", body.split("\n").filter((l) => l.length > 40).slice(0, 2).join(" ").slice(0, 300));
check("the copilot answers from the board", /Lucas|Omar|Sam|Amara/.test(body));
await page.screenshot({ path: `${OUT}/copilot.png` });

// The customer's link: only their own visit.
const customer = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
watch(customer);
await customer.goto(`${base}/track/sam-4?t=724`, { waitUntil: "load" });
await customer.getByRole("heading").waitFor({ timeout: 60000 });
await customer.waitForTimeout(1500);
let view = await customer.evaluate(() => document.body.innerText);
check("the customer link names the technician and their job", view.includes("Sam") && view.includes("Thermostat swap"), view.split("\n").find((l) => l.includes("Sam")));
check("it shows nothing about the rest of the crew", !["Priya", "Jordan", "Amara", "Lucas", "Mei", "Omar", "Tess", "Ruth A.", "Tom B.", "Rosedale"].some((w) => view.includes(w)));
await customer.screenshot({ path: `${OUT}/customer.png` });
await customer.goto(`${base}/track/sam-4?t=745`, { waitUntil: "load" });
await customer.getByRole("heading").waitFor({ timeout: 60000 });
await customer.waitForTimeout(3000);
view = await customer.evaluate(() => document.body.innerText);
check("while on the way, it gives an ETA and shows the technician", /minutes? away/.test(view) && (await customer.locator(".tech-marker").count()) === 1, view.split("\n").find((l) => /away/.test(l)));
await customer.screenshot({ path: `${OUT}/customer-on-the-way.png` });
await customer.goto(`${base}/track/sam-4?t=900`, { waitUntil: "load" });
await customer.getByRole("heading").waitFor({ timeout: 60000 });
await customer.waitForTimeout(1500);
check("after the visit, the technician's location is gone", (await customer.locator(".tech-marker").count()) === 0 && (await customer.evaluate(() => document.body.innerText)).includes("All done"));
await customer.goto(`${base}/track/nope`, { waitUntil: "load" });
await customer.getByText("isn't valid").waitFor({ timeout: 60000 });
check("a bad tracking link says so", true);
await customer.close();

// A phone-sized dispatcher.
const small = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
watch(small);
await small.goto(base, { waitUntil: "load" });
await small.getByRole("button", { name: "Pause the day" }).click({ timeout: 60000 });
await small.waitForTimeout(3000);
await small.screenshot({ path: `${OUT}/phone-map.png` });
await small.getByRole("button", { name: "Lines", exact: true }).click();
await small.waitForTimeout(400);
await small.screenshot({ path: `${OUT}/phone-lines.png` });
await small.getByRole("button", { name: /^Attention/ }).click();
await small.waitForTimeout(400);
check("the dashboard fits a phone, with no sideways page scroll", (await small.evaluate(() => document.documentElement.scrollWidth - innerWidth)) === 0);
await small.close();

// The whole loop: a phone clocks in, walks, arrives, and the board sees it live.
if (phoneUrl && liveUrl) {
  const board = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  watch(board);
  await board.goto(liveUrl, { waitUntil: "load", timeout: 240000 });
  await board.getByRole("button", { name: "Pause the day" }).click({ timeout: 60000 });

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ["geolocation"], geolocation: { latitude: 45.4215, longitude: -75.6972, accuracy: 10 } });
  const phone = await phoneCtx.newPage();
  watch(phone);
  await phone.goto(phoneUrl, { waitUntil: "load", timeout: 240000 });
  await phone.getByLabel("Your first name").waitFor({ timeout: 180000 });
  await phone.screenshot({ path: `${OUT}/field-welcome.png` });
  const phoneText = () => phone.evaluate(() => document.body.innerText);
  check("the phone says what's shared before clock-in", (await phoneText()).includes("What your dispatcher sees") && (await phoneText()).includes("What nobody sees"));
  await board.waitForTimeout(500);
  check("the board shows nothing from the phone before clock-in", !(await board.evaluate(() => document.body.innerText)).includes("Alex"));
  await phone.getByLabel("Your first name").fill("Alex");
  await phone.getByRole("button", { name: "Clock in" }).click();
  await phone.getByText("Today's line").waitFor({ timeout: 30000 });
  await phone.getByText("Connected to dispatch").waitFor({ timeout: 15000 });
  await phone.getByRole("button", { name: "Start a practice walk" }).click();
  await board.getByText("Alex clocked in").waitFor({ timeout: 15000 });
  await board.locator('[title="Alex (live phone)"]').waitFor({ timeout: 15000 });
  check("the phone appears live on the board", true);
  await phone.waitForTimeout(3000);
  await phone.screenshot({ path: `${OUT}/field-shift.png` });

  await phone.getByText("You've arrived").waitFor({ timeout: 70000 });
  await phone.screenshot({ path: `${OUT}/field-arrived.png` });
  check("arrival marks itself on the phone", true);
  await board.getByText("Alex arrived at Furnace tune-up").waitFor({ timeout: 10000 });
  check("the board hears about the arrival", true);
  await board.waitForTimeout(1500);
  await board.screenshot({ path: `${OUT}/live-board.png` });

  await phone.getByRole("button", { name: "Finish this job" }).click();
  await phone.getByText("Thermostat swap").first().waitFor();
  check("finishing moves on to the next job", (await phoneText()).includes("Next"));
  await phone.getByRole("button", { name: "Stop the practice walk" }).click();

  await phone.getByRole("button", { name: "Clock out", exact: true }).click();
  await phone.getByRole("button", { name: "Yes, clock out" }).click();
  await phone.getByRole("button", { name: "Clock in" }).waitFor();
  await board.getByText("Their location was erased").waitFor({ timeout: 10000 });
  await board.waitForTimeout(500);
  check("clocking out removes the phone from the board", (await board.locator('[title="Alex (live phone)"]').count()) === 0);
}

const unique = [...new Set(errors)];
check("no console errors", unique.length === 0, unique.join(" | ").slice(0, 500));
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
