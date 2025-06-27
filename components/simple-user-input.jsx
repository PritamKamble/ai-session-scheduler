"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

export default function UserPromptInput({ onSend }) {
  const [userInput, setUserInput] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (userInput.trim()) {
      onSend(userInput);
      setUserInput("");
    }
  };

  return (
    <>
    </>
  );
}