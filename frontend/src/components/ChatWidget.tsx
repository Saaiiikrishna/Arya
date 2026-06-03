'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { io, Socket } from 'socket.io-client';
import { Send, X, MessageSquare } from 'lucide-react';

interface ChatWidgetProps {
  teamId: string;
  userId: string;
  userName: string;
}

export default function ChatWidget({ teamId, userId, userName }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch recent history and merge it into local state, deduplicating by id and
  // preserving any optimistic (temp_*) messages that aren't yet persisted.
  const syncHistory = useCallback(async () => {
    try {
      const res = await api.getChatRoom(teamId);
      if (!res || !res.messages) return;
      // Backend returns newest first, so reverse to show chronological order.
      const history = [...res.messages].reverse();
      setMessages(prev => {
        const historyIds = new Set(history.map((m: any) => m.id));
        // Keep optimistic temp messages that haven't been confirmed by the server yet.
        const pendingOptimistic = prev.filter(
          (m: any) => typeof m.id === 'string' && m.id.startsWith('temp_') && !historyIds.has(m.id),
        );
        return [...history, ...pendingOptimistic];
      });
    } catch (err) {
      console.error(err);
    }
  }, [teamId]);

  // Load initial history
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      syncHistory();
    }
  }, [isOpen, teamId, syncHistory]);

  // Connect WebSockets
  useEffect(() => {
    // Only connect if the widget is opened to save connections
    if (!isOpen) return;

    const token = api.getToken();
    // Strip /api from the URL to connect to the root namespace
    const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/api\/?$/, '');
    const newSocket = io(baseUrl, {
      auth: { token },
      transports: ['websocket']
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
      newSocket.emit('joinRoom', { roomId: `team_${teamId}` });
      // Re-fetch recent history so messages received while disconnected are
      // not lost. This fires on both the initial connect and any reconnect.
      syncHistory();
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    newSocket.on('newMessage', (msg: any) => {
      setMessages(prev => [...prev, msg]);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [isOpen, teamId, syncHistory]);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !socket || !isConnected) return;

    // Send via socket
    socket.emit('sendMessage', {
      roomId: `team_${teamId}`,
      content: newMessage,
    });

    // Optimistic UI update
    const optimisticMsg = {
      id: `temp_${Date.now()}`,
      content: newMessage,
      senderId: userId,
      sender: { name: userName },
      createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, optimisticMsg]);
    setNewMessage('');
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-8 right-8 w-14 h-14 bg-forest text-white rounded-full border border-hairline flex-center hover:bg-forest/90 transition-transform hover:scale-105 z-50"
      >
        <MessageSquare className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-8 right-8 w-[380px] h-[550px] bg-white border border-hairline flex flex-col z-50 animate-fade-in font-sans">
      {/* Header */}
      <div className="bg-ink text-parchment p-4 flex justify-between items-center shrink-0">
        <div>
          <h3 className="font-serif font-bold text-lg leading-tight">Team Comms</h3>
          <p className="text-[10px] uppercase tracking-widest text-parchment/60 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-saffron' : 'bg-terracotta'}`}></span>
            {isConnected ? 'Connected • Secure' : 'Connecting...'}
          </p>
        </div>
        <button onClick={() => setIsOpen(false)} className="text-parchment/60 hover:text-white p-1">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 bg-parchment/20 flex flex-col gap-4">
        {messages.length === 0 ? (
          <div className="flex-1 flex-center flex-col text-ink/40 text-center">
            <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
            <p className="text-sm font-medium">No comms logged yet.</p>
            <p className="text-xs uppercase tracking-widest">Start the discussion</p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isMe = msg.senderId === userId;
            const showName = idx === 0 || messages[idx-1].senderId !== msg.senderId;
            
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {showName && !isMe && (
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40 ml-1 mb-1">
                    {msg.sender?.name || 'Operator'}
                  </span>
                )}
                <div 
                  className={`max-w-[85%] p-3 text-sm ${
                    isMe 
                      ? 'bg-forest text-white' 
                      : 'bg-white border border-hairline text-ink'
                  }`}
                >
                  <p className="leading-relaxed">{msg.content}</p>
                </div>
                <span className={`text-[9px] uppercase tracking-widest text-ink/30 mt-1 ${isMe ? 'mr-1' : 'ml-1'}`}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-white border-t border-hairline shrink-0">
        <form onSubmit={sendMessage} className="flex gap-2">
          <input 
            type="text" 
            placeholder="Transmit message..."
            className="flex-1 bg-parchment/30 border border-hairline px-3 py-2 text-sm outline-none focus:border-forest"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            disabled={!isConnected}
          />
          <button 
            type="submit" 
            disabled={!newMessage.trim() || !isConnected}
            className="bg-saffron text-parchment p-2 hover:bg-saffron-deep transition-colors disabled:opacity-50 disabled:hover:bg-saffron flex-center w-10 h-10 shrink-0"
          >
            <Send className="w-4 h-4 ml-[-2px]" />
          </button>
        </form>
      </div>
    </div>
  );
}
