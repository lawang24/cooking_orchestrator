import { hydrateRoot } from "react-dom/client";
import { LibraryApp } from "./LibraryApp";
import type { LibraryData } from "./types";
import "./styles.css";
import "./library.css";

const data: LibraryData = JSON.parse(document.getElementById("library-data")!.textContent!);
hydrateRoot(document.getElementById("root")!, <LibraryApp {...data} />);
