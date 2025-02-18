import { posts } from '../_posts';

export function get() {
	const metadata = posts.map((p) => p.metadata);
	const tags = Object.entries<number>(
		posts
			.map((p) => p.metadata.tags)
			.reduce((acc, tag) => [...acc, ...tag], [])
			.reduce((acc, tag) => {
				acc[tag] = (acc[tag] || 0) + 1;
				return acc;
			}, {} as { [tag: string]: number })
	)
		.sort(([v1, c1], [v2, c2]) => c2 - c1 || v2.localeCompare(v1))
		.slice(0, 15)
		.map(([v]) => v);

	return {
		body: { metadata, tags },
		headers: {
			'Cache-Control': `max-age=0, s-max-age=${600}` // 10 minutes
		}
	};
}
