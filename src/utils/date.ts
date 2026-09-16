import type { CollectionEntry } from "astro:content";
import { type Lang, dateLocale } from "@/i18n";
import { siteConfig } from "@/site.config";

const zhOptions: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };

export function getFormattedDate(
	date: Date | undefined,
	options?: Intl.DateTimeFormatOptions,
	lang: Lang = "zh",
): string {
	if (date === undefined) {
		return "Invalid Date";
	}
	const base = lang === "zh" ? zhOptions : (siteConfig.date.options as Intl.DateTimeFormatOptions);
	return new Intl.DateTimeFormat(dateLocale[lang], { ...base, ...options }).format(date);
}

export function collectionDateSort(
	a: CollectionEntry<"post" | "note">,
	b: CollectionEntry<"post" | "note">,
) {
	return b.data.publishDate.getTime() - a.data.publishDate.getTime();
}
