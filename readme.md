# The Tower House Academy & School

## Local setup

Requirements: Node.js 20.19 or newer and PostgreSQL 14 or newer.

1. Install the project dependencies:

   ```powershell
   npm install
   ```

2. Create a local environment file and set the PostgreSQL connection details:

   ```powershell
   Copy-Item .env.example .env
   ```

   Edit `.env` and set `DATABASE_URL` to a PostgreSQL database that already
   exists. Set `PGSSL=true` when the database provider requires verified TLS.
   Do not commit `.env`; it is excluded by `.gitignore`.

3. Start the site:

   ```powershell
   npm start
   ```

   The server creates the `enquiries` table and its indexes from
   `database/schema.sql` on startup. Open the local URL printed in the console.

`npm run dev` builds the Tailwind stylesheet and restarts the Node server when
server files change. Run `npm run build:css` after changing page markup or
Tailwind classes; `npm start` builds the CSS automatically.

## Enquiry storage

Both the contact and admission forms submit JSON to `POST /api/enquiries`.
Validated submissions are stored in PostgreSQL's `enquiries` table. The API
uses parameterized queries, applies field and programme validation, and limits
request bodies. `GET /api/health` checks database connectivity.

Without `DATABASE_URL`, the pages and stylesheet remain available, while
enquiry submission returns an explicit service-unavailable response. The
server does not send email; enquiries are saved in the database.

## Deployment configuration

Set `HOST`, `PORT`, `DATABASE_URL`, `PGSSL`, and `SITE_URL` in the deployment
environment. Use a private PostgreSQL database and a valid HTTPS `SITE_URL` for
production. `robots.txt` and `sitemap.xml` are generated using `SITE_URL`.

## Website pages

- `/` — home
- `/about.html` — about the academy
- `/programs.html` — academic programmes
- `/results.html` — student results
- `/gallery.html` — school gallery
- `/admission.html` — admission enquiry
- `/contact.html` — contact enquiry