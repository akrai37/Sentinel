"use client";
import { createContext } from "react";

export type StreamFilter = "all" | "agent" | "cisco" | "escalations";

export const StreamFilterContext = createContext<StreamFilter>("all");
