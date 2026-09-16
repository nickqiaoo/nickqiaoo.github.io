import { type CollectionEntry, getCollection } from "astro:content";
import type { Lang } from "@/i18n";
import { langOfId, slugOfId } from "./post";

type Note = CollectionEntry<"note">;

export function noteLang(note: Note): Lang {
	return langOfId(note.id);
}

export function noteSlug(note: Note): string {
	return slugOfId(note.id);
}

export function noteUrl(note: Note): string {
	return noteLang(note) === "en" ? `/en/notes/${noteSlug(note)}/` : `/notes/${noteSlug(note)}/`;
}

/** 某一种语言的笔记，默认中文 */
export async function getAllNotes(lang: Lang = "zh"): Promise<Note[]> {
	return (await getCollection("note")).filter((n) => noteLang(n) === lang);
}

/** 找同一篇笔记的另一种语言版本 */
export async function getNoteTranslation(note: Note): Promise<Note | undefined> {
	const other = noteLang(note) === "en" ? "zh" : "en";
	return (await getAllNotes(other)).find((n) => noteSlug(n) === noteSlug(note));
}
