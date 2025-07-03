import { config } from "../../../config/config.js";
import Log from "../../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Get age role based on age
 *
 * @param {number} age
 * @return {string|null}
 */
export const getAgeRole = function(age){
    if (age < 14) return null;
    if (age >= 14 && age <= 17) return config.roles.ages["14_17"];
    if (age >= 18 && age <= 24) return config.roles.ages["18_24"];
    if (age >= 25 && age <= 29) return config.roles.ages["25_29"];
    if (age >= 30 && age <= 35) return config.roles.ages["30_35"];
    if (age >= 36 && age <= 39) return config.roles.ages["36_39"];
    if (age >= 40) return config.roles["40+"];
    return null;
};

/**
 * Calculate age from birth date
 *
 * @param {string} dateInput
 * @return {number|null}
 */
export const calculateAge = function(dateInput){
    try {
        let birthDate;

        // Check if it's just a year (4 digits)
        if (/^\d{4}$/.test(dateInput)){
            birthDate = new Date(parseInt(dateInput, 10), 0, 1); // January 1st of that year
        }
        else {
            // Check if it's DD.MM.YYYY format
            const match = dateInput.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
            if (match){
                const [, day, month, year] = match;
                birthDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
            }
            else {
                return null;
            }
        }

        if (isNaN(birthDate.getTime())){
            return null;
        }

        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();

        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())){
            age--;
        }

        return age;
    }
    catch (error){
        Log.error(`Error during age calculation for user ${dateInput}:`, error);
        return null;
    }
};

/**
 * Remove existing age roles from member
 *
 * @param {import("discord.js").GuildMember} member
 * @return {Promise<void>}
 */
export const removeExistingAgeRoles = async function(member){
    const ageRoleIds = Object.values(config.roles.ages);
    for (const roleId of ageRoleIds){
        if (roleId && member.roles.cache.has(roleId)){
            await member.roles.remove(roleId).catch(() => null);
        }
    }

    const genderRoleIds = Object.values(config.roles.gender);
    for (const roleId of genderRoleIds){
        if (roleId && member.roles.cache.has(roleId)){
            await member.roles.remove(roleId).catch(() => null);
        }
    }
};
