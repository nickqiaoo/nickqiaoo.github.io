import { getAllPosts, postUrl } from "@/data/post";
import { t } from "@/i18n";
import { siteConfig } from "@/site.config";
import rss from "@astrojs/rss";

export const GET = async () => {
	const posts = await getAllPosts("en");

	return rss({
		title: `${siteConfig.title} · ${t("en", "series.name")}`,
		description: t("en", "series.desc"),
		site: import.meta.env.SITE,
		items: posts.map((post) => ({
			title: post.data.title,
			description: post.data.description,
			pubDate: post.data.publishDate,
			link: postUrl(post),
		})),
	});
};
