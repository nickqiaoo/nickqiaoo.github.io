import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { slug as slugify } from "github-slugger";

/**
 * 文章和笔记的 id 规则。和 Astro 默认规则一样按路径生成，
 * 只多一条：文件名以 .en 结尾（index.en.md、foo.en.md）是英文版，id 加 en/ 前缀。
 */
function localizedId({ entry }: { entry: string }) {
	const withoutExt = entry.replace(/\.mdx?$/, "");
	const isEn = withoutExt.endsWith(".en");
	const clean = isEn ? withoutExt.slice(0, -3) : withoutExt;
	const id = clean
		.split("/")
		.map((segment) => slugify(segment))
		.join("/")
		.replace(/\/index$/, "");
	return isEn ? `en/${id}` : id;
}

function removeDupsAndLowerCase(array: string[]) {
	return [...new Set(array.map((str) => str.toLowerCase()))];
}

const titleSchema = z.string().max(60);

const baseSchema = z.object({
	title: titleSchema,
});

const post = defineCollection({
	loader: glob({ base: "./src/content/post", pattern: "**/*.{md,mdx}", generateId: localizedId }),
	schema: ({ image }) =>
		baseSchema.extend({
			description: z.string(),
			coverImage: z
				.object({
					alt: z.string(),
					src: image(),
				})
				.optional(),
			draft: z.boolean().default(false),
			// 所属专题。目前只有 agents 一个，写错构建时会报错。
			series: z.enum(["agents"]).optional(),
			// 专题内的阅读顺序。有这个字段的文章进专题页的"从这里开始读"，没有的算日常更新。
			seriesOrder: z.number().optional(),
			ogImage: z.string().optional(),
			tags: z.array(z.string()).default([]).transform(removeDupsAndLowerCase),
			publishDate: z
				.string()
				.or(z.date())
				.transform((val) => new Date(val)),
			updatedDate: z
				.string()
				.optional()
				.transform((str) => (str ? new Date(str) : undefined)),
		}),
});

const note = defineCollection({
	loader: glob({ base: "./src/content/note", pattern: "**/*.{md,mdx}", generateId: localizedId }),
	schema: baseSchema.extend({
		description: z.string().optional(),
		publishDate: z
			.string()
			.datetime({ offset: true }) // Ensures ISO 8601 format with offsets allowed (e.g. "2024-01-01T00:00:00Z" and "2024-01-01T00:00:00+02:00")
			.transform((val) => new Date(val)),
	}),
});

const tag = defineCollection({
	loader: glob({ base: "./src/content/tag", pattern: "**/*.{md,mdx}" }),
	schema: z.object({
		title: titleSchema.optional(),
		description: z.string().optional(),
	}),
});

export const collections = { post, note, tag };
