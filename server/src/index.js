import "dotenv/config";
import { createApp } from "./app.js";
const port = process.env.PORT || 3001;
createApp().listen(port, () => console.log(`API on http://localhost:${port} (${process.env.OPENAI_API_KEY ? "OpenAI mode" : "local mode, no API key"})`));
