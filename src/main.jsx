import { createRoot } from "react-dom/client";
import App from "./App.jsx";

const root = document.getElementById("react-root");

if (root) {
  createRoot(root).render(<App />);
}
