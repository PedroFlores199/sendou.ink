import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Config } from "~/config";
import { useHasRole } from "~/modules/permissions/hooks";

const TCF_API_POLL_INTERVAL_MS = 250;
const TCF_API_POLL_ATTEMPTS = 120;
const CONSENT_DIALOG_POLL_INTERVAL_MS = 1000;

declare global {
	interface Window {
		fusetag: {
			que: Array<() => void>;
			pageInit?: () => void;
			registerZone?: (id: string) => void;
		};
		/** IAB TCF API of the consent management platform that comes with Fuse */
		__tcfapi?: (
			command: "addEventListener" | "removeEventListener" | "ping",
			version: 2,
			callback: (tcData: TcfData | undefined, success: boolean) => void,
			listenerId?: number,
		) => void;
	}
}

interface TcfData {
	/** `ping` only: whether the consent dialog is on screen right now */
	displayStatus?: "visible" | "hidden" | "disabled";
	listenerId?: number;
}

function callPageInit() {
	window.fusetag = window.fusetag || { que: [] };
	window.fusetag.que.push(() => {
		window.fusetag.pageInit?.();
	});
}

export function FusePageInit() {
	const { pathname } = useLocation();

	useEffect(() => {
		callPageInit();
	}, [pathname]);

	return null;
}

export function FuseZone({
	id,
	fuseSlot,
	className,
}: {
	id: string;
	fuseSlot: string;
	className?: string;
}) {
	useEffect(() => {
		window.fusetag = window.fusetag || { que: [] };
		window.fusetag.que.push(() => {
			window.fusetag.registerZone?.(id);
		});
	}, [id]);

	return <div id={id} data-fuse={fuseSlot} className={className} />;
}

/**
 * Whether the consent dialog is on screen. The consent management platform draws
 * it as an ordinary element, so anything of ours in the top layer covers it.
 *
 * Its events tell us that the dialog was surfaced but none of them that it was
 * closed without a choice, so the dialog is asked for its state instead, on every
 * event and then for as long as it is up.
 */
export function useConsentDialogOpen() {
	const [open, setOpen] = useState(false);
	const isPatron = useHasRole("MINOR_SUPPORT");
	const adsShown = Config.fuseEnabled && !isPatron;

	useEffect(() => {
		let cancelled = false;
		let listenerId: number | undefined;
		let poll: number | undefined;

		const readDisplayStatus = () => {
			window.__tcfapi?.("ping", 2, (tcData) => {
				if (cancelled) return;

				const isOpen = tcData?.displayStatus === "visible";
				setOpen(isOpen);

				if (isOpen && poll === undefined) {
					poll = window.setInterval(
						readDisplayStatus,
						CONSENT_DIALOG_POLL_INTERVAL_MS,
					);
				} else if (!isOpen) {
					window.clearInterval(poll);
					poll = undefined;
				}
			});
		};

		const stopWaiting = whenTcfApiReady(adsShown, (tcfapi) => {
			// every surfacing of the dialog is an event, the footer's privacy button included
			tcfapi("addEventListener", 2, (tcData, success) => {
				if (!success || !tcData) return;

				// the platform answers a registration made against its stub much later
				listenerId ??= tcData.listenerId;
				if (cancelled) {
					removeConsentListener(listenerId);
					return;
				}

				readDisplayStatus();
			});
		});

		return () => {
			cancelled = true;
			stopWaiting();
			window.clearInterval(poll);
			removeConsentListener(listenerId);
		};
	}, [adsShown]);

	return open;
}

function removeConsentListener(listenerId: number | undefined) {
	if (listenerId === undefined) return;

	window.__tcfapi?.("removeEventListener", 2, () => {}, listenerId);
}

/** Fuse loads the consent platform, so its API only shows up some time after hydration */
function whenTcfApiReady(
	adsShown: boolean,
	onReady: (tcfapi: NonNullable<Window["__tcfapi"]>) => void,
) {
	let interval: number | undefined;
	let attemptsLeft = TCF_API_POLL_ATTEMPTS;

	const stop = () => window.clearInterval(interval);

	if (window.__tcfapi) {
		onReady(window.__tcfapi);
		return stop;
	}
	if (!adsShown) return stop;

	interval = window.setInterval(() => {
		if (window.__tcfapi) {
			stop();
			onReady(window.__tcfapi);
		} else if (--attemptsLeft <= 0) {
			stop();
		}
	}, TCF_API_POLL_INTERVAL_MS);

	return stop;
}
