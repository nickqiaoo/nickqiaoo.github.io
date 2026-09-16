// 站点的语言配置和界面文案。中文是默认语言，放在根路径；英文放在 /en/ 下。
export type Lang = "zh" | "en";
export const DEFAULT_LANG: Lang = "zh";

export const htmlLang: Record<Lang, string> = { zh: "zh-CN", en: "en" };
export const ogLocale: Record<Lang, string> = { zh: "zh_CN", en: "en_GB" };
export const dateLocale: Record<Lang, string> = { zh: "zh-CN", en: "en-GB" };

const zh = {
	"nav.home": "首页",
	"nav.about": "关于",
	"nav.blog": "博客",
	"nav.agents": "Agents",
	"nav.notes": "笔记",
	"nav.menu": "主菜单",
	"nav.footer": "站内更多",
	"lang.switch": "EN",
	"lang.switchTitle": "Switch to English",
	"home.greeting": "你好，我是 nickqiao",
	"home.intro":
		"软件工程师，先后在盛大游戏、Bilibili 和百度工作，做过 Web3 创业公司的 CTO，现在专注 AI agent。",
	"home.posts": "文章",
	"home.notes": "笔记",
	"posts.title": "文章",
	"posts.desc": "我写的文章，以及我感兴趣的东西",
	"posts.in": "文章年份",
	"posts.tags": "标签",
	"posts.viewAll": "查看全部",
	"page.prev": "← 上一页",
	"page.next": "下一页 →",
	"tags.title": "标签",
	"tags.desc": "所有文章的标签",
	"tags.about": "关于 {tag} 的文章",
	"tags.count": "{n} 篇",
	"tags.viewWith": "查看带这个标签的文章",
	"notes.title": "笔记",
	"notes.desc": "我的笔记",
	"post.toc": "目录",
	"post.updated": "更新于",
	"post.readTime": "约 {n} 分钟",
	"post.viewTag": "查看带此标签的文章",
	"series.name": "Agent源码解析",
	"series.desc": "追踪七个 coding agent 的源码与每日 commit，解析它们的实现原理。",
	"series.intro":
		"追踪 codex、opencode、kimi-code、pi-mono、deepseek-harness源码。合集讲解每个项目如何实现；每日追踪解析当天值得看的 commit。",
	"series.guide": "合集",
	"series.guideHint": "源码解析汇总",
	"series.updates": "每日追踪",
	"series.empty": "还没有文章。",
	"series.position": "第 {i} / {n} 篇",
	"series.zhOnly": "仅中文",
	"series.moreZh": "另有 {n} 篇每日追踪目前只有中文版。",
	"series.nav": "专题导航",
	"404.title": "页面不存在",
	"404.desc": "这个页面不存在",
	"404.hint": "请用导航栏回到正确的地方",
	"about.title": "关于",
};

type UIKey = keyof typeof zh;

const en: Record<UIKey, string> = {
	"nav.home": "Home",
	"nav.about": "About",
	"nav.blog": "Blog",
	"nav.agents": "Agents",
	"nav.notes": "Notes",
	"nav.menu": "Main menu",
	"nav.footer": "More on this site",
	"lang.switch": "中文",
	"lang.switchTitle": "切换到中文",
	"home.greeting": "Hi, I'm nickqiao",
	"home.intro":
		"I'm a software engineer, formerly at ShengdaGames, Bilibili and Baidu, ex-CTO of a Web3 startup, now focused on AI agents.",
	"home.posts": "Posts",
	"home.notes": "Notes",
	"posts.title": "Posts",
	"posts.desc": "Read my collection of posts and the things that interest me",
	"posts.in": "Posts in",
	"posts.tags": "Tags",
	"posts.viewAll": "View all",
	"page.prev": "← Previous Page",
	"page.next": "Next Page →",
	"tags.title": "Tags",
	"tags.desc": "A list of all the topics I've written about in my posts",
	"tags.about": "Posts about {tag}",
	"tags.count": "{n} posts",
	"tags.viewWith": "View posts with the tag",
	"notes.title": "Notes",
	"notes.desc": "Read my collection of notes",
	"post.toc": "Table of Contents",
	"post.updated": "Updated:",
	"post.readTime": "{n} min read",
	"post.viewTag": "View more blogs with the tag",
	"series.name": "Agent Source Analysis",
	"series.desc":
		"Tracking the source and daily commits of seven coding agents, explaining how they work.",
	"series.intro":
		"Tracking the source code of codex, opencode, kimi-code, pi-mono and deepseek-harness. This collection explains how each project works; daily updates cover the commits worth reading that day.",
	"series.guide": "Collection",
	"series.guideHint": "Source analysis summary",
	"series.updates": "Daily updates",
	"series.empty": "No posts yet.",
	"series.position": "{i} of {n}",
	"series.zhOnly": "Chinese only",
	"series.moreZh": "{n} more daily updates are currently available in Chinese only.",
	"series.nav": "Series navigation",
	"404.title": "Page not found",
	"404.desc": "Oops! It looks like this page is lost in space!",
	"404.hint": "Please use the navigation to find your way back",
	"about.title": "About",
};

const ui: Record<Lang, Record<UIKey, string>> = { zh, en };

/** 取一条界面文案，{name} 形式的占位符用 vars 填充 */
export function t(lang: Lang, key: UIKey, vars?: Record<string, string | number>): string {
	let s = ui[lang][key];
	if (vars) {
		for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
	}
	return s;
}

/** Astro.currentLocale 转成 Lang，没配到的一律当中文 */
export function localeFrom(current: string | undefined): Lang {
	return current === "en" ? "en" : "zh";
}

export function otherLang(lang: Lang): Lang {
	return lang === "en" ? "zh" : "en";
}

export function homePath(lang: Lang) {
	return lang === "en" ? "/en/" : "/";
}

export function seriesPath(lang: Lang) {
	return lang === "en" ? "/en/agents/" : "/agents/";
}

/** 页头页脚的导航，中英文结构相同 */
export function menuLinks(lang: Lang): { path: string; title: string }[] {
	if (lang === "en") {
		return [
			{ path: "/en/", title: t(lang, "nav.home") },
			{ path: "/en/about/", title: t(lang, "nav.about") },
			{ path: "/en/posts/", title: t(lang, "nav.blog") },
			{ path: "/en/agents/", title: t(lang, "nav.agents") },
			{ path: "/en/notes/", title: t(lang, "nav.notes") },
		];
	}
	return [
		{ path: "/", title: t(lang, "nav.home") },
		{ path: "/about/", title: t(lang, "nav.about") },
		{ path: "/posts/", title: t(lang, "nav.blog") },
		{ path: "/agents/", title: t(lang, "nav.agents") },
		{ path: "/notes/", title: t(lang, "nav.notes") },
	];
}

/** 路径前缀：英文加 /en，中文没有 */
export function langPrefix(lang: Lang) {
	return lang === "en" ? "/en" : "";
}
export function postsPath(lang: Lang) {
	return `${langPrefix(lang)}/posts/`;
}
export function notesPath(lang: Lang) {
	return `${langPrefix(lang)}/notes/`;
}
export function tagsPath(lang: Lang) {
	return `${langPrefix(lang)}/tags/`;
}
export function tagPath(lang: Lang, tag: string) {
	return `${langPrefix(lang)}/tags/${tag}/`;
}
