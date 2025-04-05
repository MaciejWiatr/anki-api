import cors from "@elysiajs/cors";
import swagger from "@elysiajs/swagger";
import { Elysia, t } from "elysia";
import puppeteer, { Page } from "puppeteer";

// Get arguments from environment or use defaults
const puppeteerArgs = process.env.PUPPETEER_ARGS
  ? process.env.PUPPETEER_ARGS.split(" ")
  : ["--no-sandbox", "--disable-setuid-sandbox"];

const browser = await puppeteer.launch({
  headless: true, // Use headless in Docker
  args: puppeteerArgs,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
});

const setAuth = async (
  page: Page,
  { webToken, userToken }: { webToken?: string; userToken?: string }
) => {
  // Clear all cookies
  await browser.deleteCookie();

  if (userToken) {
    await page.setCookie(
      {
        name: "has_auth",
        value: "1",
        domain: "ankiuser.net",
        path: "/",
      },
      {
        name: "ankiweb",
        value: userToken, // Use the ankiuser.net domain token
        domain: "ankiuser.net",
        path: "/",
        httpOnly: true,
        secure: true,
      }
    );
  }

  if (webToken) {
    await page.setCookie({
      name: "has_auth",
      value: "1",
      domain: "ankiweb.net",
      path: "/",
    });
    await page.setCookie({
      name: "ankiweb",
      value: webToken,
      domain: "ankiweb.net",
      path: "/",
      httpOnly: true,
      secure: true,
    });
  }

  // Set complete headers matching the working request
  await page.setExtraHTTPHeaders({
    accept: "*/*",
    "accept-language": "pl,en-US;q=0.9,en;q=0.8",
    "content-type": "application/octet-stream",
    origin: "https://ankiuser.net",
    referer: "https://ankiuser.net/add",
    "sec-ch-ua":
      '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  });
};

const app = new Elysia()
  .use(cors())
  .use(swagger())
  .get("/", () => "Hello Elysia")
  .post(
    "/login",
    async ({ body }) => {
      const page = await browser.newPage();

      await page.goto("https://ankiweb.net/account/login");

      await page.locator('[autocomplete="username"]').fill(body.login);
      await page.locator('[type="password"]').fill(body.password);

      await page
        .locator("body > div > main > form > div:nth-child(3) > button")
        .click();

      await page.waitForNavigation();

      const cookies = await browser.cookies();

      // Find both tokens from ankiweb.net and ankiuser.net
      const ankiwebToken = cookies.find(
        (c) => c.name === "ankiweb" && c.domain === "ankiweb.net"
      )?.value;
      const ankiuserToken = cookies.find(
        (c) => c.name === "ankiweb" && c.domain === "ankiuser.net"
      )?.value;

      await browser.deleteCookie();
      await page.close();

      return {
        ankiwebToken,
        ankiuserToken,
      };
    },
    {
      body: t.Object({
        login: t.String(),
        password: t.String(),
      }),
    }
  )
  .get(
    "/decks",
    async ({ headers }) => {
      const page = await browser.newPage();

      await setAuth(page, {
        webToken: headers.anki_web_token,
      });

      await page.goto("https://ankiweb.net/decks");

      await page.waitForSelector(".btn-link.pl-0");
      const decks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll(".btn-link.pl-0")).map(
          (el) => el.textContent?.trim()
        );
      });

      await page.close();

      return decks;
    },
    {
      headers: t.Object({
        anki_web_token: t.String(),
      }),
    }
  )
  .post(
    "/decks/add",
    async ({ body, headers }) => {
      const page = await browser.newPage();

      await page.goto("https://ankiuser.net/add");

      await setAuth(page, {
        userToken: headers.anki_user_token,
      });

      await page.goto("https://ankiuser.net/add", {
        waitUntil: ["networkidle0", "domcontentloaded", "load"],
      });

      await page
        .locator("body > div > main > div.form-group.row.mt-2.mb-4 > div > div")
        .click();

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const options = await page.evaluate(() => {
        function elemToSelector(elem: Element): string {
          const { tagName, id, className, parentNode } = elem;

          if (tagName === "HTML") return "HTML";

          let str = tagName;

          str += id !== "" ? `#${id}` : "";

          if (className) {
            const classes = className.split(/\s/);
            for (let i = 0; i < classes.length; i++) {
              str += `.${classes[i]}`;
            }
          }

          let childIndex = 1;

          for (
            let e = elem;
            e.previousElementSibling;
            e = e.previousElementSibling
          ) {
            childIndex += 1;
          }

          str += `:nth-child(${childIndex})`;

          return `${elemToSelector(parentNode as Element)} > ${str}`;
        }

        return Array.from(document.querySelectorAll(".list-item")).map(
          (el) => ({
            text: el.textContent?.trim(),
            selector: elemToSelector(el),
          })
        );
      });

      const option = options.find((o) => o.text === body.deck);

      if (!option) {
        throw new Error("Deck not found");
      }

      await page.click(option.selector);

      const frontSelector =
        "body > div > main > form > div:nth-child(1) > div > div";
      const backSelector =
        "body > div > main > form > div:nth-child(2) > div > div";
      const submitButtonSelector = "body > div > main > form > button";

      await page.locator(frontSelector).fill(body.front);
      await page.locator(backSelector).fill(body.back);

      await page.locator(submitButtonSelector).click();

      await page.close();

      return "ok";
    },
    {
      headers: t.Object({
        anki_user_token: t.String(),
      }),
      body: t.Object({
        deck: t.String(),
        front: t.String(),
        back: t.String(),
        tags: t.Optional(t.Array(t.String())),
      }),
    }
  )
  .listen(3000);

console.log(
  `Anki API is running at ${app.server?.hostname}:${app.server?.port}`
);

process.on("SIGINT", async () => {
  await browser.close();
});
