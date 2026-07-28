export interface UserListEntry {
    userID: number;
    playername: string;
    level: number;
    lastaction: number;
    userTags: string;
    IconsList: string;
}

export interface UserListResponse {
    success: boolean;
    list: UserListEntry[];
    total: number;
}

export interface UserStats {
    hoursPerDay: number;
    xanaxPerDay: number;
    streak: number;
}
