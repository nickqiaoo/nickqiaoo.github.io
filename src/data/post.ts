import { type CollectionEntry, getCollection } from "astro:content";
import type { Lang } from "@/i18n";

type Post = CollectionEntry<"post">;

/** 内容条目的语言：id 带 en/ 前缀的是英文版 */
export function langOfId(id: string): Lang {
	return id.startsWith("en/") ? "en" : "zh";
}

/** 去掉语言前缀后的 slug，中英两个版本的 slug 相同 */
export function slugOfId(id: string): string {
	return id.replace(/^en\//, "");
}

export function postLang(post: Post): Lang {
	return langOfId(post.id);
}

export function postSlug(post: Post): string {
	return slugOfId(post.id);
}

/** 文章页地址，英文版在 /en/ 下 */
export function postUrl(post: Post): string {
	return postLang(post) === "en" ? `/en/posts/${postSlug(post)}/` : `/posts/${postSlug(post)}/`;
}

/** 所有语言的文章，生产环境不含草稿 */
export async function getAllPostsAllLangs(): Promise<Post[]> {
	return await getCollection("post", ({ data }) => {
		return import.meta.env.PROD ? !data.draft : true;
	});
}

/** 某一种语言的文章，默认中文，生产环境不含草稿 */
export async function getAllPosts(lang: Lang = "zh"): Promise<Post[]> {
	return (await getAllPostsAllLangs()).filter((p) => postLang(p) === lang);
}

/** 找同一篇文章的另一种语言版本 */
export async function getTranslation(post: Post): Promise<Post | undefined> {
	const other = postLang(post) === "en" ? "zh" : "en";
	return (await getAllPosts(other)).find((p) => postSlug(p) === postSlug(post));
}

/** Get tag metadata by tag name */
export async function getTagMeta(tag: string): Promise<CollectionEntry<"tag"> | undefined> {
	const tagEntries = await getCollection("tag", (entry) => {
		return entry.id === tag;
	});
	return tagEntries[0];
}

/** groups posts by year (based on option siteConfig.sortPostsByUpdatedDate), using the year as the key
 *  Note: This function doesn't filter draft posts, pass it the result of getAllPosts above to do so.
 */
export function groupPostsByYear(posts: CollectionEntry<"post">[]) {
	return posts.reduce<Record<string, CollectionEntry<"post">[]>>((acc, post) => {
		const year = post.data.publishDate.getFullYear();
		if (!acc[year]) {
			acc[year] = [];
		}
		acc[year]?.push(post);
		return acc;
	}, {});
}

/** returns all tags created from posts (inc duplicate tags)
 *  Note: This function doesn't filter draft posts, pass it the result of getAllPosts above to do so.
 *  */
export function getAllTags(posts: CollectionEntry<"post">[]) {
	return posts.flatMap((post) => [...post.data.tags]);
}

/** returns all unique tags created from posts
 *  Note: This function doesn't filter draft posts, pass it the result of getAllPosts above to do so.
 *  */
export function getUniqueTags(posts: CollectionEntry<"post">[]) {
	return [...new Set(getAllTags(posts))];
}

/** returns a count of each unique tag - [[tagName, count], ...]
 *  Note: This function doesn't filter draft posts, pass it the result of getAllPosts above to do so.
 *  */
export function getUniqueTagsWithCount(posts: CollectionEntry<"post">[]): [string, number][] {
	return [
		...getAllTags(posts).reduce(
			(acc, t) => acc.set(t, (acc.get(t) ?? 0) + 1),
			new Map<string, number>(),
		),
	].sort((a, b) => b[1] - a[1]);
}

export type SeriesName = "agents";

/** 专题里的"每日追踪"类文章：属于某个专题，但没有指定阅读顺序 */
export function isSeriesUpdate(post: CollectionEntry<"post">) {
	return !!post.data.series && post.data.seriesOrder === undefined;
}

/** 按专题取文章，拆成两组：按顺序阅读的长文，和按时间倒序的日常更新 */
export function getSeriesPosts(posts: CollectionEntry<"post">[], series: SeriesName) {
	const inSeries = posts.filter((p) => p.data.series === series);
	const guide = inSeries
		.filter((p) => p.data.seriesOrder !== undefined)
		.sort((a, b) => (a.data.seriesOrder ?? 0) - (b.data.seriesOrder ?? 0));
	const updates = inSeries
		.filter((p) => p.data.seriesOrder === undefined)
		.sort((a, b) => b.data.publishDate.getTime() - a.data.publishDate.getTime());
	return { guide, updates };
}
