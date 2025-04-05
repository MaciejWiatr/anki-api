# Anki API

A REST API for interacting with AnkiWeb and AnkiUser services, built with Elysia and Bun.

## Features

- Login to AnkiWeb and get authentication tokens
- List available decks
- Add new cards to decks with front, back, and optional tags

## Getting Started

1. Clone the repository:

```bash
git clone <repository-url>
cd anki-api
```

2. Install dependencies:

```bash
bun install
```

3. Start the development server:

```bash
bun run dev
```

The API will be available at http://localhost:3000

## API Endpoints

### POST /login

Authenticate with AnkiWeb and get tokens.

Request body:

```json
{
  "login": "your_anki_username",
  "password": "your_anki_password"
}
```

Response:

```json
{
  "ankiwebToken": "your_ankiweb_token",
  "ankiuserToken": "your_ankiuser_token"
}
```

### GET /decks

List all available decks.

Headers:

```
anki_web_token: your_ankiweb_token
```

### POST /decks/add

Add a new card to a deck.

Headers:

```
anki_user_token: your_ankiuser_token
```

Request body:

```json
{
  "deck": "deck_name",
  "front": "card_front",
  "back": "card_back",
  "tags": ["optional", "tags"]
}
```

## API Documentation

Swagger documentation is available at http://localhost:3000/swagger when the server is running.

## Development

The project uses:

- Bun as the runtime
- Elysia as the web framework
- Puppeteer for browser automation
- CORS for cross-origin requests
- Swagger for API documentation
