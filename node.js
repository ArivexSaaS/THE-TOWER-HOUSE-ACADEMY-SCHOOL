"use strict";

require("dotenv").config();

const fs = require("fs");
const http = require("http");
const path = require("path");
const { Pool } = require("pg");

const ROOT = __dirname;
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8000);
const MAX_BODY_BYTES = 16 * 1024;
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_SSL = process.env.PGSSL === "true";
const SCHEMA_PATH = path.join(ROOT, "database", "schema.sql");

const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
    ".xml": "application/xml; charset=utf-8"
};

const PAGE_ROUTES = {
    "/about": "/about.html",
    "/admission": "/admission.html",
    "/admissions": "/admission.html",
    "/admissions.html": "/admission.html",
    "/contact": "/contact.html",
    "/gallery": "/gallery.html",
    "/programs": "/programs.html",
    "/result": "/results.html",
    "/result.html": "/results.html",
    "/results": "/results.html"
};

const ENQUIRY_PROGRAMS = {
    admission: new Set([
        "O Level",
        "A Level",
        "Other / Need guidance"
    ]),
    contact: new Set([
        "Admissions",
        "O Level",
        "A Level",
        "PhD Guidance",
        "General Enquiry"
    ])
};

const pool = DATABASE_URL
    ? new Pool({
        connectionString: DATABASE_URL,
        max: Number(process.env.PG_POOL_MAX) || 10,
        ssl: DATABASE_SSL ? { rejectUnauthorized: true } : undefined
    })
    : null;

if (pool) {
    pool.on("error", (error) => {
        console.error("Unexpected PostgreSQL pool error:", error.message);
    });
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
    });
    res.end(JSON.stringify(payload));
}

function getSiteUrl() {
    const configuredUrl = process.env.SITE_URL || `http://${HOST}:${PORT}`;

    try {
        const url = new URL(configuredUrl);

        if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error("SITE_URL must use http or https.");
        }

        return url.origin;
    } catch (error) {
        throw new Error(`Invalid SITE_URL: ${error.message}`);
    }
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let bytesRead = 0;
        let oversized = false;

        req.on("data", (chunk) => {
            bytesRead += chunk.length;

            if (bytesRead > MAX_BODY_BYTES) {
                oversized = true;
                return;
            }

            chunks.push(chunk);
        });

        req.on("end", () => {
            if (oversized) {
                reject(Object.assign(new Error("Request body is too large."), {
                    statusCode: 413
                }));
                return;
            }

            try {
                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

                if (!body || Array.isArray(body) || typeof body !== "object") {
                    throw new Error("Request body must be a JSON object.");
                }

                resolve(body);
            } catch (error) {
                reject(Object.assign(
                    new Error(`Invalid JSON request body: ${error.message}`),
                    { statusCode: 400 }
                ));
            }
        });

        req.on("error", reject);
    });
}

function validateEnquiry(body) {
    const enquiryType = body.enquiryType;

    if (enquiryType !== "contact" && enquiryType !== "admission") {
        return { error: "Choose a valid enquiry type." };
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const guardian = typeof body.guardian === "string"
        ? body.guardian.trim()
        : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const program = typeof body.program === "string" ? body.program.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!name || name.length > 100) {
        return { error: "Name is required and must be 100 characters or fewer." };
    }

    if (
        (enquiryType === "admission" && !guardian) ||
        guardian.length > 100
    ) {
        return {
            error: "Parent/guardian name is required for admissions and must be 100 characters or fewer."
        };
    }

    if (
        phone.length > 30 ||
        !/^[+()\d.\-\s]+$/.test(phone) ||
        (phone.match(/\d/g) || []).length < 7
    ) {
        return { error: "Enter a valid contact number." };
    }

    if (!ENQUIRY_PROGRAMS[enquiryType].has(program)) {
        return { error: "Choose a valid programme or enquiry type." };
    }

    if (
        (enquiryType === "contact" && !message) ||
        message.length > 1000
    ) {
        return {
            error: "A message is required for contact enquiries and must be 1,000 characters or fewer."
        };
    }

    return {
        enquiry: {
            enquiryType,
            name,
            guardian: guardian || null,
            phone,
            program,
            message
        }
    };
}

async function submitEnquiry(req, res) {
    const contentType = req.headers["content-type"] || "";

    if (!contentType.toLowerCase().startsWith("application/json")) {
        sendJson(res, 415, {
            success: false,
            message: "Send the enquiry as JSON."
        });
        return;
    }

    let body;

    try {
        body = await readRequestBody(req);
    } catch (error) {
        sendJson(res, error.statusCode || 400, {
            success: false,
            message: error.message
        });
        return;
    }

    const validation = validateEnquiry(body);

    if (validation.error) {
        sendJson(res, 400, {
            success: false,
            message: validation.error
        });
        return;
    }

    if (!pool) {
        sendJson(res, 503, {
            success: false,
            message: "Enquiry storage is not configured. Please contact the academy by phone."
        });
        return;
    }

    const { enquiry } = validation;

    try {
        const result = await pool.query(
            `INSERT INTO enquiries
                (enquiry_type, name, guardian, phone, program, message)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, created_at`,
            [
                enquiry.enquiryType,
                enquiry.name,
                enquiry.guardian,
                enquiry.phone,
                enquiry.program,
                enquiry.message
            ]
        );

        sendJson(res, 201, {
            success: true,
            message: "Your enquiry has been received by the academy.",
            enquiry: result.rows[0]
        });
    } catch (error) {
        console.error("Could not save enquiry to PostgreSQL:", error.message);
        sendJson(res, 500, {
            success: false,
            message: "We could not save your enquiry. Please try again later."
        });
    }
}

function buildSitemap(siteUrl) {
    const pages = [
        "/",
        "/about.html",
        "/programs.html",
        "/results.html",
        "/gallery.html",
        "/admission.html",
        "/contact.html"
    ];
    const urls = pages.map((page) =>
        `    <url><loc>${siteUrl}${page}</loc></url>`
    ).join("\n");

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        urls,
        "</urlset>",
        ""
    ].join("\n");
}

function serveStaticFile(req, res, pathname) {
    const mappedPath = pathname === "/"
        ? "/index.html"
        : PAGE_ROUTES[pathname] || pathname;
    const requestedPath = path.resolve(ROOT, `.${mappedPath}`);
    const relativePath = path.relative(ROOT, requestedPath);

    if (
        relativePath.startsWith(`..${path.sep}`) ||
        relativePath === ".." ||
        path.isAbsolute(relativePath)
    ) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    const blockedPaths = new Set([
        ".env",
        ".env.example",
        ".gitignore",
        "database",
        "node.js",
        "package-lock.json",
        "package.json",
        "server.js",
        "tailwind.config.js",
        "tailwind.input.css"
    ]);
    const firstPathPart = relativePath.split(path.sep)[0];

    if (
        blockedPaths.has(relativePath) ||
        blockedPaths.has(firstPathPart) ||
        relativePath.split(path.sep).some((part) => part.startsWith("."))
    ) {
        res.writeHead(404);
        res.end("404 - File Not Found");
        return;
    }

    fs.stat(requestedPath, (error, stats) => {
        if (error || !stats.isFile()) {
            res.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8"
            });
            res.end("404 - File Not Found");
            return;
        }

        const contentType =
            MIME_TYPES[path.extname(requestedPath).toLowerCase()] ||
            "application/octet-stream";

        res.writeHead(200, {
            "Cache-Control": "no-cache",
            "Content-Length": stats.size,
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff"
        });

        if (req.method === "HEAD") {
            res.end();
            return;
        }

        const stream = fs.createReadStream(requestedPath);

        stream.on("error", (streamError) => {
            console.error(`Could not serve ${relativePath}:`, streamError.message);

            if (!res.headersSent) {
                res.writeHead(500);
            }

            res.end();
        });

        stream.pipe(res);
    });
}

const server = http.createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
        res.writeHead(405, {
            "Allow": "GET, HEAD, POST",
            "Content-Type": "text/plain; charset=utf-8"
        });
        res.end("Method Not Allowed");
        return;
    }

    let pathname;

    try {
        pathname = decodeURIComponent(
            new URL(req.url, "http://localhost").pathname
        );
    } catch {
        res.writeHead(400);
        res.end("Bad Request");
        return;
    }

    if (req.method === "POST" && pathname === "/api/enquiries") {
        await submitEnquiry(req, res);
        return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
        if (!pool) {
            sendJson(res, 503, {
                status: "unavailable",
                database: "not_configured"
            });
            return;
        }

        try {
            await pool.query("SELECT 1");
            sendJson(res, 200, { status: "ok", database: "connected" });
        } catch (error) {
            console.error("PostgreSQL health check failed:", error.message);
            sendJson(res, 503, { status: "unavailable", database: "disconnected" });
        }
        return;
    }

    if (req.method === "GET" && pathname === "/robots.txt") {
        try {
            const siteUrl = getSiteUrl();
            const body = `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
            res.writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8",
                "X-Content-Type-Options": "nosniff"
            });
            res.end(body);
        } catch (error) {
            console.error(error.message);
            res.writeHead(500);
            res.end("Could not build robots.txt");
        }
        return;
    }

    if (req.method === "GET" && pathname === "/sitemap.xml") {
        try {
            const siteUrl = getSiteUrl();
            res.writeHead(200, {
                "Content-Type": "application/xml; charset=utf-8",
                "X-Content-Type-Options": "nosniff"
            });
            res.end(buildSitemap(siteUrl));
        } catch (error) {
            console.error(error.message);
            res.writeHead(500);
            res.end("Could not build sitemap.xml");
        }
        return;
    }

    if (pathname.startsWith("/api/")) {
        sendJson(res, 404, { success: false, message: "API route not found." });
        return;
    }

    if (req.method === "POST") {
        res.writeHead(405, {
            "Allow": "GET, HEAD",
            "Content-Type": "text/plain; charset=utf-8"
        });
        res.end("Method Not Allowed");
        return;
    }

    serveStaticFile(req, res, pathname);
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;

async function startServer() {
    if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
        throw new Error("PORT must be a valid TCP port between 1 and 65535.");
    }

    if (pool) {
        await pool.query(fs.readFileSync(SCHEMA_PATH, "utf8"));
        console.log("PostgreSQL connected; enquiry schema is ready.");
    } else {
        console.warn(
            "DATABASE_URL is not set. The website will run, but enquiry submission is disabled."
        );
    }

    server.listen(PORT, HOST, () => {
        console.log(`The Tower House Academy website is running at http://${HOST}:${PORT}`);
    });
}

startServer().catch(async (error) => {
    console.error("Could not start the website server:", error.message);

    if (pool) {
        await pool.end().catch((closeError) => {
            console.error("Could not close PostgreSQL pool:", closeError.message);
        });
    }

    process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        server.close(async () => {
            if (pool) {
                await pool.end();
            }
            process.exit(0);
        });
    });
}
