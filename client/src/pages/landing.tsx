import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Shield, Key, Clock, KeyRound, Plus, Phone, Zap, UserX, Image, Mic, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function Landing() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [defaultTTLSeconds, setDefaultTTLSeconds] = useState<number>(60); // default 1 minute
  
  const createChatMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/chat/create', { defaultMessageTTLSeconds: defaultTTLSeconds });
      return response.json();
    },
    onSuccess: (data) => {
      setLocation(`/chat-link/${data.roomId}`);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create chat room. Please try again.",
        variant: "destructive",
      });
    },
  });
  
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-background via-card to-background">
      {/* Header */}
      <header className="border-b border-border/30 bg-card/20 backdrop-blur-md">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary/70 rounded-xl flex items-center justify-center shadow-lg">
              <LockKeyhole className="text-primary-foreground w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold gradient-text-loading">
              KChat
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-4xl w-full space-y-12 animate-in fade-in duration-700">
          {/* Hero Section */}
          <div className="text-center space-y-6">
            <div className="w-20 h-20 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center mx-auto shadow-lg">
              <LockKeyhole className="text-primary w-10 h-10" />
            </div>
            
            <div className="space-y-4">
              <h1 className="text-5xl sm:text-6xl font-bold tracking-tight gradient-text-loading leading-tight">
                Private Chat. No Strings Attached.
              </h1>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Create a secure, anonymous chat room in seconds. No accounts, no history, no logs. Just pure privacy.
              </p>
            </div>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        
            <Card className="bg-card/50 border-border/30 hover:bg-card/70 transition-colors">
              <CardContent className="flex items-center space-x-3 p-4">
                <UserX className="text-primary w-6 h-6 flex-shrink-0" />
                <div>
                  <div className="font-medium text-sm">Stay Anonymous</div>
                  <div className="text-xs text-muted-foreground">No sign-up means no data to collect.</div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/30 hover:bg-card/70 transition-colors">
              <CardContent className="flex items-center space-x-3 p-4">
                <Image className="text-purple-400 w-6 h-6 flex-shrink-0" />
                <div>
                  <div className="font-medium text-sm">Share Moments, Not Memories</div>
                  <div className="text-xs text-muted-foreground">Images vanish after they're viewed.</div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/30 hover:bg-card/70 transition-colors">
              <CardContent className="flex items-center space-x-3 p-4">
                <Phone className="text-blue-400 w-6 h-6 flex-shrink-0" />
                <div>
                  <div className="font-medium text-sm">Crystal-Clear & Secure</div>
                  <div className="text-xs text-muted-foreground">Encrypted voice calls for when text isn't enough.</div>
                </div>
              </CardContent>
            </Card>

          </div>

          {/* CTA Section */}
          <div className="text-center space-y-6">
            <Button 
              onClick={() => createChatMutation.mutate()}
              disabled={createChatMutation.isPending}
              className="px-8 py-6 text-lg font-semibold bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg hover:shadow-xl transition-all duration-200"
              size="lg"
            >
              <Plus className="w-5 h-5 mr-2" />
              {createChatMutation.isPending ? "Creating..." : "Create Your Secure Chat"}
            </Button>

            <div className="mt-3 flex items-center justify-center space-x-3">
              <label className="text-sm text-muted-foreground">Message auto-delete:</label>
              <select
                value={defaultTTLSeconds}
                onChange={(e) => setDefaultTTLSeconds(Number(e.target.value))}
                className="bg-card/20 border border-border rounded px-2 py-1 text-sm"
              >
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
                <option value={180}>3 minutes</option>
                <option value={240}>4 minutes</option>
                <option value={300}>5 minutes</option>
              </select>
            </div>

            <p className="text-sm text-muted-foreground">
              Your privacy is a click away.
            </p>
          </div>

          {/* Security Footer */}
          <div className="text-center space-y-2 pt-8 border-t border-border/30">
            <div className="flex items-center justify-center space-x-4 text-xs text-muted-foreground">
              <div className="flex items-center space-x-1">
                <Shield className="w-3 h-3 text-success" />
                <span>Serverless & Secure</span>
              </div>
              <div className="flex items-center space-x-1">
                <Zap className="w-3 h-3 text-warning" />
                <span>Conversations Vanish</span>
              </div>
              <div className="flex items-center space-x-1">
                <Key className="w-3 h-3 text-primary" />
                <span>Locked & Private</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
