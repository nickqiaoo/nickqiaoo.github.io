import { toString as mdastToString } from "mdast-util-to-string";
import getReadingTime from "reading-time";

export function remarkReadingTime() {
	// @ts-expect-error:next-line
	return (tree, { data }) => {
		const textOnPage = mdastToString(tree);
		const readingTime = getReadingTime(textOnPage);
		data.astro.frontmatter.readingTime = readingTime.text;
		// 分钟数单独存一份，页面按语言自己拼文案
		data.astro.frontmatter.minutesRead = Math.max(1, Math.ceil(readingTime.minutes));
	};
}
