import cors from "@elysiajs/cors";
import swagger from "@elysiajs/swagger";
import { Elysia, t } from "elysia";
import puppeteer, { Browser, Page } from "puppeteer";

// Configure puppeteer launch options
const getLaunchOptions = () => ({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

const setAuth = async (
  page: Page,
  browser: Browser,
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
      // Launch a new browser for this request
      const browser = await puppeteer.launch(getLaunchOptions());
      try {
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
      } finally {
        // Ensure browser is closed even if there's an error
        await browser.close();
      }
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
      // Launch a new browser for this request
      const browser = await puppeteer.launch(getLaunchOptions());
      try {
        const page = await browser.newPage();

        await setAuth(page, browser, {
          webToken: headers.anki_web_token,
        });

        await page.goto("https://ankiweb.net/decks");
        const content = await page.content();
        return content;
      } finally {
        // Ensure browser is closed even if there's an error
        await browser.close();
      }
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
      // Launch a new browser for this request
      const browser = await puppeteer.launch(getLaunchOptions());
      try {
        const page = await browser.newPage();

        // First visit the page without cookies to establish context
        await page.goto("https://ankiuser.net/add");

        await setAuth(page, browser, {
          userToken: headers.anki_user_token,
        });

        // Navigate again with full cookies and headers
        await page.goto("https://ankiuser.net/add", {
          waitUntil: ["networkidle0", "domcontentloaded", "load"],
        });

        await page
          .locator(
            "body > div > main > div.form-group.row.mt-2.mb-4 > div > div"
          )
          .click();

        // sleep 1 second
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // get inner html of body > div > main > div.form-group.row.mt-2.mb-4 > div > div
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

        // Helper function to get input selector by label text
        const getInputSelectorByLabel = (labelText: string): string => {
          return `//span[contains(@class, 'col-form-label') and text()='${labelText}']/following-sibling::div/input`;
        };

        // Fill in the front and back fields
        await page.locator(getInputSelectorByLabel("Front")).fill(body.front);
        await page.locator(getInputSelectorByLabel("Back")).fill(body.back);

        // Fill in tags if provided
        if (body.tags && body.tags.length > 0) {
          await page
            .locator(getInputSelectorByLabel("Tags"))
            .fill(body.tags.join(" "));
        }

        return "ok";
      } finally {
        // Ensure browser is closed even if there's an error
        await browser.close();
      }
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
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);

// Graceful shutdown - no longer need to close a shared browser instance
process.on("SIGINT", async () => {
  console.log("Shutting down server...");
  process.exit(0);
});
