import type { Root } from "hast";
import type { Plugin } from "unified";
import { SKIP, visit } from "unist-util-visit";

// Keep native table semantics while containing wide content in its own scroll area.
export const rehypeScrollableTables: Plugin<[], Root> = () => (tree) => {
	visit(tree, "element", (node, index, parent) => {
		if (node.tagName !== "table" || !parent || index === undefined) return;
		parent.children[index] = {
			type: "element",
			tagName: "div",
			properties: { className: ["table-scroll"], tabIndex: 0 },
			children: [node],
		};
		return SKIP;
	});
};
