import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import { queryClient } from "./lib/queries";
import { I18nProvider } from "./i18n";
import { RequireAuth } from "./components/AppShell";
import { RouteError } from "./components/RouteError";
import { ToastProvider } from "./components/Toaster";
import { LoginPage, VerifyPage } from "./routes/auth";
import { BankPage } from "./routes/bank";
import { ConnectPage } from "./routes/connect";
import { IntegrationsPage } from "./routes/integrations";
import { ProjectsPage } from "./routes/projects";
import { IdeaPage } from "./routes/idea";
import { AllIdeasPage, ArchivePage, FolderPage, InboxPage } from "./routes/lists";

const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/auth/verify", element: <VerifyPage /> },
      {
        element: <RequireAuth />,
        children: [
          { index: true, element: <BankPage /> },
          { path: "inbox", element: <InboxPage /> },
          { path: "all", element: <AllIdeasPage /> },
          { path: "archive", element: <ArchivePage /> },
          { path: "folders/:folderId", element: <FolderPage /> },
          { path: "ideas/:ideaId", element: <IdeaPage /> },
          { path: "connect", element: <ConnectPage /> },
          { path: "integrations", element: <IntegrationsPage /> },
          { path: "projects", element: <ProjectsPage /> },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        {/* Honors prefers-reduced-motion for every Motion animation. */}
        <MotionConfig reducedMotion="user">
          <ToastProvider>
            <div className="ambient" aria-hidden />
            <div className="grain" aria-hidden />
            <RouterProvider router={router} />
          </ToastProvider>
        </MotionConfig>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
