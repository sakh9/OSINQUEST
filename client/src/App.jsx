import Home from './pages/Home';
import { Analytics } from "@vercel/analytics/react"

function App() {
  return (
    <div>
      <Home />
      {/* Vercel Web Analytics tracking component */}
      <Analytics />
    </div>
  );
}

export default App;