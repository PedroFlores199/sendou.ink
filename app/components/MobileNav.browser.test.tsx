import type * as React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { MobileNav } from "./MobileNav";

type TcfCallback = Parameters<NonNullable<Window["__tcfapi"]>>[2];

// the consent platform only comes with the ads
vi.mock("~/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/config")>();

	return { ...actual, Config: { ...actual.Config, fuseEnabled: true } };
});

let consentListeners: TcfCallback[] = [];
let consentDialogOnScreen = false;
let cleanupFns: Array<() => void> = [];

beforeEach(async () => {
	await page.viewport(375, 667);

	consentListeners = [];
	consentDialogOnScreen = false;
	window.__tcfapi = (command, _version, callback) => {
		if (command === "addEventListener") {
			consentListeners.push(callback);
			callback({ listenerId: consentListeners.length }, true);
		} else if (command === "ping") {
			callback(
				{ displayStatus: consentDialogOnScreen ? "visible" : "hidden" },
				true,
			);
		}
	};
});

afterEach(() => {
	window.__tcfapi = undefined;
	for (const cleanup of cleanupFns) {
		cleanup();
	}
	cleanupFns = [];
});

describe("MobileNav", () => {
	test("leaves the top layer while the consent dialog is shown", async () => {
		await render(withRouter(<MobileNav sidebarData={undefined} />));
		const bar = mobileNav();

		await vi.waitFor(() => expect(bar.matches(":popover-open")).toBe(true));

		const consentButton = renderConsentDialogStandIn(bar);
		expect(topmostElementAt(consentButton)).not.toBe(consentButton);

		showConsentDialog();
		await vi.waitFor(() => expect(bar.matches(":popover-open")).toBe(false));

		expect(topmostElementAt(consentButton)).toBe(consentButton);
		expect(bar.getBoundingClientRect().height).toBeGreaterThan(0);

		closeConsentDialog({ withEvent: true });
		await vi.waitFor(() => expect(bar.matches(":popover-open")).toBe(true));
	});

	test("leaves the top layer when the dialog is already up as it mounts", async () => {
		consentDialogOnScreen = true;

		await render(withRouter(<MobileNav sidebarData={undefined} />));

		await vi.waitFor(() =>
			expect(mobileNav().matches(":popover-open")).toBe(false),
		);
	});

	test("catches a dialog opened before the consent platform has loaded", async () => {
		const consentPlatform = window.__tcfapi;
		window.__tcfapi = undefined;
		consentDialogOnScreen = true;

		await render(withRouter(<MobileNav sidebarData={undefined} />));
		const bar = mobileNav();

		await vi.waitFor(() => expect(bar.matches(":popover-open")).toBe(true));

		window.__tcfapi = consentPlatform;
		await vi.waitFor(() => expect(bar.matches(":popover-open")).toBe(false), {
			timeout: 5000,
		});
	});

	test("comes back to the top layer when the dialog is closed without a choice", async () => {
		await render(withRouter(<MobileNav sidebarData={undefined} />));
		const bar = mobileNav();

		showConsentDialog();
		await vi.waitFor(() => expect(bar.matches(":popover-open")).toBe(false));

		closeConsentDialog({ withEvent: false });
		await vi.waitFor(() => expect(bar.matches(":popover-open")).toBe(true), {
			timeout: 5000,
		});
	});
});

function withRouter(element: React.ReactElement) {
	const router = createMemoryRouter([{ path: "*", element }], {
		initialEntries: ["/"],
	});
	return <RouterProvider router={router} />;
}

function mobileNav() {
	const bar = document.getElementById("mobile-nav");
	if (!bar) throw new Error("no mobile nav rendered");
	return bar;
}

function showConsentDialog() {
	consentDialogOnScreen = true;
	notifyConsentListeners();
}

/** The platform has no event for the dialog being dismissed without a choice */
function closeConsentDialog({ withEvent }: { withEvent: boolean }) {
	consentDialogOnScreen = false;
	if (withEvent) {
		notifyConsentListeners();
	}
}

function notifyConsentListeners() {
	for (const [index, listener] of consentListeners.entries()) {
		listener({ listenerId: index + 1 }, true);
	}
}

/** Stands in for the consent dialog: an ordinary element with a huge z-index, over the bar */
function renderConsentDialogStandIn(bar: HTMLElement) {
	const dialog = document.createElement("div");
	dialog.style.cssText = `position: fixed; inset: auto 0 0 0; height: ${bar.getBoundingClientRect().height}px; z-index: 2147483647`;

	const button = document.createElement("button");
	button.type = "button";
	button.textContent = "Agree";
	button.style.cssText = "position: absolute; inset: 0";
	dialog.append(button);

	document.body.append(dialog);
	cleanupFns.push(() => dialog.remove());

	return button;
}

function topmostElementAt(element: HTMLElement) {
	const rect = element.getBoundingClientRect();

	return document.elementFromPoint(
		rect.left + rect.width / 2,
		rect.top + rect.height / 2,
	);
}
