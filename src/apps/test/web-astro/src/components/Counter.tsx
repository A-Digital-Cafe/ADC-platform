import { useState } from "react";

/** Isla React hidratada por astro (`client:load`): lo que valida la integración. */
export default function Counter() {
	const [count, setCount] = useState(0);
	return (
		<button type="button" onClick={() => setCount(count + 1)}>
			clicks: {count}
		</button>
	);
}
