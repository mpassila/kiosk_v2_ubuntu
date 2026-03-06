import moment from 'moment';

class MonthYear {
    public date: Date;

    constructor(date: Date) {
        this.date = date;
    }

    public static fromMonthYear(month: number, year: number): MonthYear {
        const date = new Date(year, month - 1, 1);
        return new MonthYear(date);
    }

    public getMonth() {
        return this.date.getMonth() + 1;
    }

    static getNextHelper() {
        const now = new Date();
        const todayStart = new Date(new Date().setHours(0, 0, 0, 0))
        const todayEnd = new Date(new Date().setHours(23, 59, 59, 999))

        const tomorrowStart = new Date(new Date(new Date().setHours(0, 0, 0, 0)).setDate(new Date().getDate() + 1))
        const tomorrowEnd = new Date(new Date(new Date().setHours(23, 59, 59, 999)).setDate(new Date().getDate() + 1))

        const monthStart = new Date(new Date(new Date().getFullYear(), new Date().getMonth(), 1).setHours(0, 0, 0, 0))
        const monthEnd = new Date(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).setHours(23, 59, 59, 999))

        const nextMonthStart = new Date(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).setHours(0, 0, 0, 0))
        const nextMonthEnd = new Date(new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0).setHours(23, 59, 59, 999))
        return <any> {
            timestamp: now,
            todayStart: todayStart,
            todayEnd: todayEnd,
            tomorrowStart:  tomorrowStart,
            tomorrowEnd: tomorrowEnd,
            monthStart: monthStart,
            monthEnd: monthEnd,
            nextMonthStart: nextMonthStart,
            nextMonthEnd: nextMonthEnd
        }
    }
    static getNextHelperAt(timestamp) {
        const now = new Date(timestamp);
        const todayStart = new Date(new Date(timestamp).setHours(0, 0, 0, 0))
        const todayEnd = new Date(new Date(timestamp).setHours(23, 59, 59, 999))

        const tomorrowStart = new Date(new Date(new Date(timestamp).setHours(0, 0, 0, 0)).setDate(new Date(timestamp).getDate() + 1))
        const tomorrowEnd = new Date(new Date(new Date(timestamp).setHours(23, 59, 59, 999)).setDate(new Date(timestamp).getDate() + 1))

        const monthStart = new Date(new Date(new Date( timestamp).getFullYear(), new Date( timestamp).getMonth(), 1).setHours(0, 0, 0, 0))
        const monthEnd = new Date(new Date(new Date( timestamp).getFullYear(), new Date( timestamp).getMonth() + 1, 0).setHours(23, 59, 59, 999))

        const nextMonthStart = new Date(new Date(new Date( timestamp).getFullYear(), new Date( timestamp).getMonth() + 1, 1).setHours(0, 0, 0, 0))
        const nextMonthEnd = new Date(new Date(new Date( timestamp).getFullYear(), new Date( timestamp).getMonth() + 2, 0).setHours(23, 59, 59, 999))
        return <any> {
            timestamp: now,
            todayStart: todayStart,
            todayEnd: todayEnd,
            tomorrowStart:  tomorrowStart,
            tomorrowEnd: tomorrowEnd,
            monthStart: monthStart,
            monthEnd: monthEnd,
            nextMonthStart: nextMonthStart,
            nextMonthEnd: nextMonthEnd
        }
    }


    public getYear() {
        return this.date.getFullYear();
    }

    public equals(monthYear: MonthYear) {
        return this.getMonth() === monthYear.getMonth() && this.getYear() === monthYear.getYear();
    }

    public static endOfDayAtCurrentLocation(license, testedDate) {
        const endOfGivenDay = moment(testedDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');
        return moment(endOfGivenDay).unix() * 1000;
    }

    public static isWinterTime() {
        const weekday = moment().isoWeekday();
        const week = moment().isoWeek();

        const day = +moment().endOf('day').format('D');
        const month = +moment().endOf('day').format('M');
        const year = +moment().endOf('day').format('YYYY');

        let isWinterTime;
        switch (year) {
            case 2021:
                // 2021	March 14	November 7
                isWinterTime = month < 3 || (month === 3 && day < 14) || month > 11 || (month === 11 && day >= 7) ? false : true;
                break;
            case 2022:
                // 2022	March 13	November 6
                isWinterTime = (month <= 3 && day < 13) || (month >= 11 && day >= 6) ? true : false;
                break;
            case 2023:
                isWinterTime = (month <= 3 && day < 12) || (month >= 11 && day >= 5) ? true : false;
                break
            // 2023	March 12	November 5
            case 2024:
                isWinterTime = (month <= 3 && day < 10) || (month >= 11 && day >= 3) ? true : false;
                break
            // 2024	March 10	November 3
            case 2025:
                isWinterTime = (month <= 3 && day < 9) || (month >= 11 && day >= 2) ? true : false;
                break
            // 2025	March 9	November 2
            case 2026:
                isWinterTime = (month <= 3 && day < 8) || (month >= 11 && day >= 1) ? true : false;
                break
            // 2026	March 8	November 1
            case 2027:
                isWinterTime = (month <= 3 && day < 14) || (month >= 11 && day >= 7) ? true : false;
                break
            // 2027	March 14	November 7
            case 20298:
                isWinterTime = (month <= 3 && day < 12) || (month >= 11 && day >= 5) ? true : false;
                break
            // 2028	March 12	November 5
            case 2029:
                isWinterTime = (month <= 3 && day < 11) || (month >= 11 && day >= 4) ? true : false;
                // 2029	March 11	November 4
                break;

            default:
                isWinterTime = false;
                break;
        }
        return isWinterTime;
        // return false;
    }
}

export default MonthYear;
