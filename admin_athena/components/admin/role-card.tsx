"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, Users, Cpu, Wrench, Pencil, Trash2 } from "lucide-react";

interface RoleCardProps {
  role: {
    id: string;
    name: string;
    description: string | null;
    isSystemRole: boolean;
    allowedModels: unknown;
    permissions: unknown;
    personalMcpEnabled: boolean;
    dailyRequestLimit: number | null;
    dailyTokenLimit: number | null;
    memberCount: number;
  };
  onEdit: () => void;
  onDelete: () => void;
}

export function RoleCard({ role, onEdit, onDelete }: RoleCardProps) {
  const models = Array.isArray(role.allowedModels) ? role.allowedModels : [];
  const perms = Array.isArray(role.permissions) ? role.permissions : [];

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">{role.name}</CardTitle>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={onEdit} className="h-8 w-8">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {!role.isSystemRole && (
              <Button variant="ghost" size="icon" onClick={onDelete} className="h-8 w-8 text-red-500 hover:text-red-600">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        {role.description && (
          <p className="text-sm text-muted-foreground">{role.description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>{role.memberCount} users</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Cpu className="h-3.5 w-3.5" />
            <span>{models.length} models</span>
          </div>
          {role.personalMcpEnabled && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Wrench className="h-3.5 w-3.5" />
              <span>MCP</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {perms.map((p: string) => (
            <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
          ))}
        </div>

        {(role.dailyRequestLimit || role.dailyTokenLimit) && (
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Limits: {role.dailyRequestLimit ? `${role.dailyRequestLimit} req/day` : ""}
            {role.dailyRequestLimit && role.dailyTokenLimit ? " · " : ""}
            {role.dailyTokenLimit ? `${(role.dailyTokenLimit / 1000).toFixed(0)}K tokens/day` : ""}
          </div>
        )}

        {role.isSystemRole && (
          <Badge variant="secondary" className="text-xs">System Role</Badge>
        )}
      </CardContent>
    </Card>
  );
}
