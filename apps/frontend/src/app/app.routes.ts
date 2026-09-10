import { Routes } from "@angular/router";

import { authGuard } from "./core/auth.guard";

export const routes: Routes = [
    {
        path: "login",
        loadComponent: () => import("./pages/login/login").then((m) => m.Login),
    },
    {
        path: "auth/callback",
        loadComponent: () => import("./pages/callback/callback").then((m) => m.Callback),
    },
    // The editor sits outside the shell on purpose: the handoff hides the tab bar
    // while an expense is being edited.
    {
        path: "groups/:groupId/expenses/:expenseId",
        canActivate: [authGuard],
        loadComponent: () => import("./pages/editor/editor").then((m) => m.Editor),
    },
    {
        path: "",
        canActivate: [authGuard],
        loadComponent: () => import("./ui/shell").then((m) => m.Shell),
        children: [
            { path: "", pathMatch: "full", redirectTo: "expenses" },
            {
                path: "expenses",
                loadComponent: () => import("./pages/expenses/expenses").then((m) => m.Expenses),
            },
            {
                path: "groups",
                loadComponent: () => import("./pages/groups/groups").then((m) => m.Groups),
            },
            {
                path: "groups/:id",
                loadComponent: () => import("./pages/group/group").then((m) => m.GroupView),
            },
            {
                path: "balances",
                loadComponent: () => import("./pages/balances/balances").then((m) => m.Balances),
            },
            {
                path: "profile",
                loadComponent: () => import("./pages/profile/profile").then((m) => m.Profile),
            },
        ],
    },
    { path: "**", redirectTo: "" },
];
