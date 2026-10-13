"use strict";

const menuToggle = document.getElementById("menu-toggle");
const navLinks = document.getElementById("nav-links");

function closeMenu() {
    if (!menuToggle || !navLinks) return;

    navLinks.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation menu");
    menuToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
}

if (menuToggle && navLinks) {
    menuToggle.addEventListener("click", () => {
        const isOpen = navLinks.classList.toggle("open");

        menuToggle.setAttribute("aria-expanded", String(isOpen));
        menuToggle.setAttribute(
            "aria-label",
            isOpen ? "Close navigation menu" : "Open navigation menu"
        );
        menuToggle.innerHTML = isOpen
            ? '<i class="fa-solid fa-xmark"></i>'
            : '<i class="fa-solid fa-bars"></i>';
    });

    navLinks.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", closeMenu);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeMenu();
    });

    window.addEventListener("resize", () => {
        if (window.innerWidth > 760) closeMenu();
    });
}

const currentYear = document.getElementById("current-year");

if (currentYear) {
    currentYear.textContent = new Date().getFullYear();
}

const backToTop = document.getElementById("back-to-top");

if (backToTop) {
    function updateBackToTop() {
        backToTop.classList.toggle("visible", window.scrollY > 350);
    }

    window.addEventListener("scroll", updateBackToTop, { passive: true });
    updateBackToTop();
}

function formatEnquiry(form) {
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const guardian = String(data.get("guardian") || "").trim();
    const phone = String(data.get("phone") || "").trim();
    const program = String(data.get("program") || "").trim();
    const message = String(data.get("message") || "").trim();
    const lines = [
        "THE TOWER HOUSE ACADEMY & SCHOOL",
        "",
        `Name: ${name}`
    ];

    if (guardian) lines.push(`Parent/guardian: ${guardian}`);

    lines.push(
        `Phone: ${phone}`,
        `Program: ${program}`,
        `Message: ${message || "No additional message"}`
    );

    return lines.join("\n");
}

async function submitEnquiry(form) {
    const status = form.querySelector('[role="status"]');
    const button = form.querySelector('button[type="submit"]');
    const originalButtonContent = button ? button.innerHTML : "";

    if (status) {
        status.textContent = "Sending your enquiry securely...";
    }

    if (button) {
        button.disabled = true;
        button.textContent = "Sending...";
    }

    try {
        const response = await fetch("/api/enquiries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Your enquiry could not be saved.");
        }

        form.reset();

        if (status) {
            status.textContent = result.message;
            status.dataset.state = "success";
        }
    } catch (error) {
        console.error("Could not submit enquiry:", error);

        if (status) {
            status.textContent = error.message ||
                "We could not send your enquiry. Please try again later.";
            status.dataset.state = "error";
        }
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = originalButtonContent;
        }
    }
}

["contact-form", "admission-form"].forEach((formId) => {
    const form = document.getElementById(formId);

    if (!form) return;

    form.addEventListener("submit", (event) => {
        event.preventDefault();

        if (!form.reportValidity()) return;

        void submitEnquiry(form);
    });
});
