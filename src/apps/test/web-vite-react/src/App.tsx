import { useState } from "react";

/**
 * App mínima a propósito: lo que se ejercita es el **bundler**, no la UI.
 * Cubre JSX, hooks y CSS importado, que es lo que rompe cuando cambia vite.
 */
export default function App() {
	const [count, setCount] = useState(0);

	return (
		<main className="probe">
			<h1>Vite + React probe</h1>
			<p>Si ves esto, la estrategia `vite-react` compiló y sirvió el bundle.</p>
			<button type="button" onClick={() => setCount(count + 1)}>
				clicks: {count}
			</button>
		</main>
	);
}
